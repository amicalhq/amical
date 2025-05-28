# AI Inference Configuration

Amical supports two AI inference options for transcription:

1. **OpenAI Whisper** (default)
2. **Amical Cloud** (hosted endpoint)

## Configuration

### Using OpenAI (Default)

By default, Amical uses OpenAI's Whisper API. You need to provide an API key either:

- Through the UI: Open settings and go to "Configure API Key" tab
- Via environment variable: `OPENAI_API_KEY=your_key_here`

### Using Amical Cloud

To use the Amical Cloud hosted endpoint instead:

1. Set the environment variable: `USE_CLOUD_INFERENCE=true`
2. No API key is required for cloud inference

## Examples

### Running with OpenAI (default)
```bash
# Set API key via environment
OPENAI_API_KEY=sk-your-openai-key npm run dev

# Or just run normally and set API key through UI
npm run dev
```

### Running with Amical Cloud
```bash
USE_CLOUD_INFERENCE=true npm run dev
```

### Running with both environment variables
```bash
USE_CLOUD_INFERENCE=true OPENAI_API_KEY=sk-backup-key npm run dev
```

## Cloud Endpoint Details

When using Amical Cloud (`USE_CLOUD_INFERENCE=true`), the app makes POST requests to:

- **URL**: `https://dictation.amical.ai/transcribe`
- **Headers**:
  - `Content-Type: application/json`
  - `x-admin-api-key: asdsa`
  - `x-org-user-id: <random_generated_id>`
- **Model**: Groq Whisper Large v3
- **Format**: Returns unformatted transcription

## Switching Between Modes

To switch between inference modes, simply restart the application with the appropriate environment variable:

```bash
# Switch to cloud
USE_CLOUD_INFERENCE=true npm run dev

# Switch back to OpenAI
npm run dev
```

The application will log which inference mode is being used on startup. 