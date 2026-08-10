import {
    env,
    pipeline,
    AutoProcessor,
    AutoModelForAudioFrameClassification,
} from '@huggingface/transformers';

// Allow local models first, but allow remote fallback from Hugging Face CDN if not bundled locally
env.allowLocalModels = true;
env.allowRemoteModels = true;
env.localModelPath = '/models/';

const PER_DEVICE_CONFIG = {
    webgpu: {
        dtype: {
            encoder_model: 'fp32',
            decoder_model_merged: 'q4',
        },
        device: 'webgpu',
    },
    wasm: {
        dtype: 'q8',
        device: 'wasm',
    },
};

/**
 * This class uses the Singleton pattern to ensure that only one instance of the model is loaded.
 */
class PipelineSingleton {
    static asr_model_id = 'whisper-base_timestamped';
    static asr_instance = null;
    static currentDevice = null;

    static segmentation_model_id = 'pyannote-segmentation-3.0';
    static segmentation_instance = null;
    static segmentation_processor = null;

    static async getInstance(progress_callback = null, device = 'webgpu') {
        if (this.currentDevice !== device) {
            this.asr_instance = null;
            this.currentDevice = device;
        }

        const loadAsr = async () => {
            try {
                return await pipeline('automatic-speech-recognition', this.asr_model_id, {
                    ...PER_DEVICE_CONFIG[device],
                    progress_callback,
                });
            } catch (err) {
                console.warn('Local ASR model not found, fetching remote model from Hugging Face Hub:', err);
                return await pipeline('automatic-speech-recognition', 'onnx-community/whisper-base_timestamped', {
                    ...PER_DEVICE_CONFIG[device],
                    progress_callback,
                });
            }
        };

        const loadSegProcessor = async () => {
            try {
                return await AutoProcessor.from_pretrained(this.segmentation_model_id, { progress_callback });
            } catch (err) {
                console.warn('Local segmentation processor not found, fetching remote:', err);
                return await AutoProcessor.from_pretrained('onnx-community/pyannote-segmentation-3.0', { progress_callback });
            }
        };

        const loadSegModel = async () => {
            try {
                return await AutoModelForAudioFrameClassification.from_pretrained(this.segmentation_model_id, {
                    device: 'wasm',
                    dtype: 'fp32',
                    progress_callback,
                });
            } catch (err) {
                console.warn('Local segmentation model not found, fetching remote:', err);
                return await AutoModelForAudioFrameClassification.from_pretrained('onnx-community/pyannote-segmentation-3.0', {
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
        if (!this.segmentation_processor) {
            this.segmentation_processor = loadSegProcessor().catch((err) => {
                this.segmentation_processor = null;
                throw err;
            });
        }
        if (!this.segmentation_instance) {
            this.segmentation_instance = loadSegModel().catch((err) => {
                this.segmentation_instance = null;
                throw err;
            });
        }

        return Promise.all([this.asr_instance, this.segmentation_processor, this.segmentation_instance]);
    }
}

async function load({ device }) {
    self.postMessage({
        status: 'loading',
        data: `Loading models (${device})...`
    });

    let transcriber;
    try {
        [transcriber] = await PipelineSingleton.getInstance(x => {
            self.postMessage(x);
        }, device);
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
            }, 'wasm');
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

async function run({ audio, language, meetingId }) {
    const device = PipelineSingleton.currentDevice || 'wasm';
    const [transcriber, segmentation_processor, segmentation_model] = await PipelineSingleton.getInstance(null, device);

    const start = performance.now();

    const transcribeOptions = {
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
