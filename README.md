# PromptNavi - AI Image Generation & Interpolation Studio

An interactive node-based interface for AI image generation and attribute interpolation. Generate images using different AI models and seamlessly blend visual attributes between them.

![PromptNavi Interface]

## Features

 **Multi-Model Support**
- DALL-E 2 & DALL-E 3 (via OpenAI API)
- Stable Diffusion (local generation)

 **Visual Attribute Interpolation**
- Extract visual attributes from generated images
- Connect attributes between nodes using an intuitive drag-and-drop interface
- Generate new images by blending multiple visual features

 **Intelligent Analysis**
- Automatic feature extraction using GPT-4o and CLIP
- Categorized attributes: Appearance, Composition, Atmosphere
- Visual confidence scoring for each attribute

 **Interactive Canvas**
- Node-based workflow for visual thinking
- Real-time connection visualization
- Drag-and-drop attribute linking

## System Requirements

### Hardware
- **Minimum**: 8GB RAM, any GPU with 4GB+ VRAM (for Stable Diffusion)
- **Recommended**: 16GB+ RAM, NVIDIA GPU with 12GB+ VRAM
- **CPU Only**: Supported but slower for Stable Diffusion

### Software
- Python 3.8+
- CUDA 11.8+ (for GPU acceleration)
- Modern web browser (Chrome, Firefox, Safari, Edge)

## Installation

### 1. Clone the Repository
```bash
git clone
cd promptnavi
```

### 2. Create Virtual Environment
```bash
python -m venv venv

# Windows
venv\Scripts\activate

# macOS/Linux
source venv/bin/activate
```

### 3. Install Dependencies
```bash
pip install -r requirements.txt
```

### 4. GPU Setup (Optional but Recommended)
```bash
# For CUDA 11.8
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118

# For memory optimization (optional)
pip install xformers
```

### 5. Environment Configuration
Create a `.env` file in the project root:

```env
# Required: OpenAI API Key
OPENAI_API_KEY=your_openai_api_key_here

# Optional: Stable Diffusion Model
SD_MODEL_ID=runwayml/stable-diffusion-v1-5

# Optional: API Configuration
SD_API_URL=http://localhost:7860
```

## Usage

### 1. Start the Application
```bash
cd backend
python app.py
```

The application will be available at `http://localhost:5000`

### 2. Generate Your First Image

1. **Select a Model**: Choose between DALL-E 2, DALL-E 3, or Stable Diffusion
2. **Enter a Prompt**: Describe the image you want to generate
3. **Click Generate**: Wait for the AI to create your image

### 3. Attribute Interpolation

1. **Generate Multiple Images**: Create 2+ images with different styles
2. **Add Empty Frame**: Click "Add Empty Frame" to create a generation target
3. **Connect Attributes**: Drag from attribute points on source images to the empty frame
4. **Generate Blend**: Click "Generate" on the empty frame to create an interpolated image

### 4. Advanced Features

- **Adjust Weights**: Double-click connection lines to modify attribute influence
- **Fold Attributes**: Click the triangle to collapse attribute panels
- **Analyze Existing Images**: The system automatically extracts visual features

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/generate` | POST | Generate single image |
| `/api/interpolate` | POST | Generate interpolated image |
| `/api/analyze` | POST | Analyze image features |
| `/api/proxy-image` | POST | Proxy external images |
| `/api/health` | GET | System health check |

## Configuration Options

### Model Selection
- **DALL-E 2**: Fast, cost-effective, good quality
- **DALL-E 3**: Highest quality, better prompt adherence
- **Stable Diffusion**: Local generation, customizable, free

### Image Sizes
- **256x256**: Fast generation, lower quality
- **512x512**: Balanced speed/quality (SD default)
- **1024x1024**: High quality, slower generation

### Quality Settings
- **Standard**: Default quality level
- **HD**: Higher quality (DALL-E 3 only)

## Troubleshooting

### Common Issues

**"Unsupported model" Error**
- Ensure you have the required API keys
- Check that Stable Diffusion dependencies are installed
- Verify your `.env` file configuration

**Slow Stable Diffusion Generation**
- Install xformers for memory optimization: `pip install xformers`
- Reduce image size to 512x512
- Use GPU if available

**Connection Issues**
- Refresh the browser page
- Check browser console for errors
- Ensure the backend server is running

**Memory Errors**
- Close other applications
- Reduce batch size for Stable Diffusion
- Use CPU mode if GPU memory is insufficient

### Performance Tips

1. **GPU Acceleration**: Ensure CUDA is properly installed
2. **Memory Management**: Close unused applications
3. **Model Caching**: First Stable Diffusion run downloads ~4GB model
4. **Browser Cache**: Clear cache if interface behaves unexpectedly

## Development

### Project Structure
```
promptnavi/
├── backend/
│   ├── app.py              # Flask server
│   ├── ai_service.py       # AI model integration
│   ├── clip_service.py     # CLIP analysis
│   └── templates/          # HTML templates
├── frontend/
│   ├── scripts/            # JavaScript modules
│   ├── styles/             # CSS files
│   └── index.html          # Main interface
├── requirements.txt        # Python dependencies
└── README.md              # This file
```

### Adding New Models
1. Extend `ai_service.py` with new model integration
2. Update model selection in `frontend/index.html`
3. Add model-specific parameters as needed

### Contributing
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

## Acknowledgments

- OpenAI for DALL-E models and GPT-4o
- Hugging Face for Transformers and CLIP
- Stability AI for Stable Diffusion
- The open-source community for various libraries
