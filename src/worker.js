import {
    env,
    pipeline,
    AutoProcessor,
    AutoModelForAudioFrameClassification,
} from '@huggingface/transformers';

// Default to remote model loading first unless local model is verified
env.allowLocalModels = false;
env.allowRemoteModels = true;
env.localModelPath = '/models/';

const PER_DEVICE_CONFIG = {
    webgpu: {
        dtype: {
            encoder_model: 'fp16',
            decoder_model_merged: 'q4',
        },
        device: 'webgpu',
    },
    wasm: {
        dtype: 'q8',
        device: 'wasm',
    },
};

const checkLocalModelExists = async (folderName) => {
    try {
        const res = await fetch(`/models/${folderName}/config.json`, { method: 'GET' });
        const contentType = res.headers.get('content-type') || '';
        return res.ok && contentType.includes('application/json');
    } catch {
        return false;
    }
};

/**
 * This class uses the Singleton pattern to ensure that only one instance of the model is loaded.
 */
class PipelineSingleton {
    static asr_model_id = 'whisper-large-v3-turbo_timestamped';
    static asr_instance = null;
    static currentDevice = null;

    static segmentation_model_id = 'pyannote-segmentation-3.0';
    static segmentation_instance = null;
    static segmentation_processor = null;

    static async getInstance(progress_callback = null, device = 'webgpu', modelId = 'whisper-large-v3-turbo_timestamped') {
        if (this.currentDevice !== device || this.asr_model_id !== modelId) {
            this.asr_instance = null;
            this.currentDevice = device;
            this.asr_model_id = modelId;
        }

        const loadAsr = async () => {
            const localModelId = this.asr_model_id.includes('/') ? this.asr_model_id.split('/').pop() : this.asr_model_id;
            const remoteModelId = this.asr_model_id.includes('/') ? this.asr_model_id : `onnx-community/${this.asr_model_id}`;

            const isLocalAvailable = await checkLocalModelExists(localModelId);
            env.allowLocalModels = isLocalAvailable;
            env.allowRemoteModels = true;

            const targetModel = isLocalAvailable ? localModelId : remoteModelId;

            try {
                return await pipeline('automatic-speech-recognition', targetModel, {
                    ...PER_DEVICE_CONFIG[device],
                    progress_callback,
                });
            } catch (err) {
                console.warn(`ASR model (${targetModel}) load failed, retrying directly from Hugging Face Hub (${remoteModelId}):`, err);
                env.allowLocalModels = false;
                env.allowRemoteModels = true;
                return await pipeline('automatic-speech-recognition', remoteModelId, {
                    ...PER_DEVICE_CONFIG[device],
                    progress_callback,
                });
            }
        };

        const loadSegProcessor = async () => {
            const isLocalAvailable = await checkLocalModelExists(this.segmentation_model_id);
            env.allowLocalModels = isLocalAvailable;
            env.allowRemoteModels = true;
            const targetModel = isLocalAvailable ? this.segmentation_model_id : `onnx-community/${this.segmentation_model_id}`;
            
            try {
                return await AutoProcessor.from_pretrained(targetModel, { progress_callback });
            } catch (err) {
                console.warn('Local segmentation processor failed, retrying remote:', err);
                env.allowLocalModels = false;
                env.allowRemoteModels = true;
                return await AutoProcessor.from_pretrained(`onnx-community/${this.segmentation_model_id}`, { progress_callback });
            }
        };

        const loadSegModel = async () => {
            const isLocalAvailable = await checkLocalModelExists(this.segmentation_model_id);
            env.allowLocalModels = isLocalAvailable;
            env.allowRemoteModels = true;
            const targetModel = isLocalAvailable ? this.segmentation_model_id : `onnx-community/${this.segmentation_model_id}`;
            
            try {
                return await AutoModelForAudioFrameClassification.from_pretrained(targetModel, {
                    device: 'wasm',
                    dtype: 'fp32',
                    progress_callback,
                });
            } catch (err) {
                console.warn('Local segmentation model failed, retrying remote:', err);
                env.allowLocalModels = false;
                env.allowRemoteModels = true;
                return await AutoModelForAudioFrameClassification.from_pretrained(`onnx-community/${this.segmentation_model_id}`, {
                    device: 'wasm',
                    dtype: 'fp32',
                    progress_callback,
                });
            }
        };

        if (!this.asr_instance) {
            this.asr_instance = loadAsr().catch((err) => {
                this.asr_instance = null;
                throw err;
            });
        }
        const asr = await this.asr_instance;

        if (!this.segmentation_processor) {
            this.segmentation_processor = loadSegProcessor().catch((err) => {
                this.segmentation_processor = null;
                throw err;
            });
        }
        const segProc = await this.segmentation_processor;

        if (!this.segmentation_instance) {
            this.segmentation_instance = loadSegModel().catch((err) => {
                this.segmentation_instance = null;
                throw err;
            });
        }
        const segModel = await this.segmentation_instance;

        return [asr, segProc, segModel];
    }
}

async function load({ device, modelId = 'whisper-large-v3-turbo_timestamped' }) {
    self.postMessage({
        status: 'loading',
        data: `Loading models (${device})...`
    });

    let transcriber;
    try {
        [transcriber] = await PipelineSingleton.getInstance(x => {
            self.postMessage(x);
        }, device, modelId);
    } catch (err) {
        if (device === 'webgpu') {
            console.warn('WebGPU failed, falling back to WASM backend:', err);
            self.postMessage({
                status: 'loading',
                data: 'WebGPU unavailable. Falling back to WASM...'
            });
            device = 'wasm';
            [transcriber] = await PipelineSingleton.getInstance(x => {
                self.postMessage(x);
            }, 'wasm', modelId);
        } else {
            throw err;
        }
    }

    if (device === 'webgpu') {
        self.postMessage({
            status: 'loading',
            data: 'Compiling shaders and warming up model...'
        });

        await transcriber(new Float32Array(16_000), {
            language: 'en',
        });
    }

    self.postMessage({ status: 'loaded' });
}

async function segment(processor, model, audio) {
    const inputs = await processor(audio);
    const { logits } = await model(inputs);
    const segments = processor.post_process_speaker_diarization(logits, audio.length)[0];

    // Attach labels
    for (const segment of segments) {
        segment.label = model.config.id2label[segment.id];
    }

    return segments;
}

async function run({ audio, language, meetingId, modelId }) {
    const device = PipelineSingleton.currentDevice || 'wasm';
    const [transcriber, segmentation_processor, segmentation_model] = await PipelineSingleton.getInstance(null, device, modelId);

    const start = performance.now();

    const transcribeOptions = {
        task: 'transcribe',
        return_timestamps: 'word',
        chunk_length_s: 30,
    };
    if (language && language !== 'auto') {
        transcribeOptions.language = language;
    }

    // Run transcription and segmentation in parallel
    const [transcript, segments] = await Promise.all([
        transcriber(audio, transcribeOptions),
        segment(segmentation_processor, segmentation_model, audio)
    ]);
    const end = performance.now();

    self.postMessage({ status: 'complete', meetingId, result: { transcript, segments }, time: end - start });
}

// Listen for messages from the main thread
self.addEventListener('message', async (e) => {
    const { type, data } = e.data;

    try {
        switch (type) {
            case 'load':
                await load(data);
                break;
            case 'run':
                await run(data);
                break;
        }
    } catch (error) {
        self.postMessage({ status: 'error', error: error.message || String(error) });
    }
});

