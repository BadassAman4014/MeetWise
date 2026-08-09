$ErrorActionPreference = 'Stop'
$modelsDirectory = Join-Path $PSScriptRoot '..\public\models'
New-Item -ItemType Directory -Force -Path $modelsDirectory | Out-Null

$repositories = @(
    @{ Name = 'whisper-base_timestamped'; Url = 'https://huggingface.co/onnx-community/whisper-base_timestamped.git' },
    @{ Name = 'pyannote-segmentation-3.0'; Url = 'https://huggingface.co/onnx-community/pyannote-segmentation-3.0.git' }
)

foreach ($repository in $repositories) {
    $destination = Join-Path $modelsDirectory $repository.Name
    if (Test-Path $destination) {
        Write-Host "Skipping $($repository.Name): already present."
        continue
    }
    Write-Host "Downloading $($repository.Name)…"
    git clone $repository.Url $destination
}
