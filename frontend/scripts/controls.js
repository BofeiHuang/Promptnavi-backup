import Canvas from './canvas.js';
import apiService from './api.js';
class Controls {
    constructor() {
        if (window.controlsInstance) {
            return window.controlsInstance;
        }
        window.controlsInstance = this;
        this.canvas = null;
        this.isGenerating = false;
        this.isProcessing = false;
        this.initZoomEvents();
        try {
            this.initializeElements();
            this.validateElements();
            this.initializeCanvas();
            this.bindEvents();
        } catch (error) {
            console.error('Controls initialization failed:', error);
            throw error;
        }
    }
    initZoomEvents() {
        const zoomSlider = document.getElementById('zoom-slider');
        if (zoomSlider && this.canvas) {
            zoomSlider.addEventListener('input', (e) => {
                const scale = parseInt(e.target.value) / 100;
                this.canvas.setZoom(scale);
            });
        }
    }
    initializeElements() {
        this.promptInput = document.querySelector('#prompt-input');
        this.generateBtn = document.querySelector('#generate-btn');
        this.emptyFrameBtn = document.querySelector('#empty-frame-btn');
        this.toolbar = {
            clear: document.querySelector('#clear-btn'),
            undo: document.querySelector('#undo-btn'),
            redo: document.querySelector('#redo-btn'),
            toggleAttributes: document.querySelector('#toggle-attributes-btn'),
            autoLayout: document.querySelector('#auto-layout-btn'),
            centerView: document.querySelector('#center-view-btn')
        };
        this.settings = {
            model: document.querySelector('#model-select'),
            size: document.querySelector('#size-select'),
            quality: document.querySelector('#quality-select')
        };
        this.loadingElement = document.querySelector('#loading');
        this.loadingText = this.loadingElement?.querySelector('.loading-text');
    }
    validateElements() {
        const requiredElements = {
            'Prompt input': this.promptInput,
            'Generate button': this.generateBtn,
            'Empty frame button': this.emptyFrameBtn,
            'Loading element': this.loadingElement
        };
        const missingElements = Object.entries(requiredElements)
            .filter(([, element]) => !element)
            .map(([name]) => name);
        if (missingElements.length > 0) {
            throw new Error(`Missing required elements: ${missingElements.join(', ')}`);
        }
    }
    initializeButtonStates() {
        if (this.generateBtn) {
            this.generateBtn.disabled = !this.promptInput?.value.trim();
        }
        if (this.toolbar.undo) {
            this.toolbar.undo.disabled = true;
        }
        if (this.toolbar.redo) {
            this.toolbar.redo.disabled = true;
        }
    }
    initializeCanvas() {
        try {
            const canvasContainer = document.querySelector('.canvas-container');
            if (!canvasContainer) {
                throw new Error('Canvas container not found');
            }
            this.canvas = new Canvas(canvasContainer);
            console.log('Canvas initialized successfully');
        } catch (error) {
            console.error('Failed to initialize canvas:', error);
            this.showError('Failed to initialize canvas');
        }
    }
    bindEvents() {
        this.handleEmptyFrame = this.debounce(this._handleEmptyFrame.bind(this), 300);
        if (this.generateBtn) {
            this.generateBtn.addEventListener('click', () => this.handleGenerate());
        }
        if (this.emptyFrameBtn) {
            this.emptyFrameBtn.removeEventListener('click', this.handleEmptyFrame);
            this.emptyFrameBtn.addEventListener('click', this.handleEmptyFrame);
        }
        if (this.toolbar.clear) {
            this.toolbar.clear.addEventListener('click', () => this.handleClear());
        }
        if (this.toolbar.undo) {
            this.toolbar.undo.addEventListener('click', () => this.handleUndo());
        }
        if (this.toolbar.redo) {
            this.toolbar.redo.addEventListener('click', () => this.handleRedo());
        }
        if (this.toolbar.toggleAttributes) {
            this.toolbar.toggleAttributes.addEventListener('click', () => this.handleToggleAttributes());
        }
        if (this.promptInput) {
            this.promptInput.addEventListener('input', () => this.handlePromptInput());
            this.promptInput.addEventListener('keydown', (e) => this.handlePromptKeydown(e));
        }
        Object.values(this.settings).forEach(select => {
            if (select) {
                select.addEventListener('change', () => this.handleSettingsChange());
            }
        });
        document.addEventListener('historyUpdated', (e) => this.handleHistoryUpdate(e));
    }
    async handleGenerate() {
    if (this.isGenerating) return;

    const prompt = this.promptInput?.value.trim();
    if (!prompt) {
        this.showError('Please enter a prompt');
        return;
    }

    try {
        this.setLoading(true, 'Generating image...');
        this.isGenerating = true;
        this.updateGenerateButton();
        this.disableInteractions();

        const settings = {
            model: this.settings.model?.value || 'dall-e-2',
            size: this.settings.size?.value || '1024x1024',
            quality: this.settings.quality?.value || 'standard'
        };

        const result = await apiService.generateImage(prompt, settings);

        if (!result.success) {
            throw new Error(result.error || 'Failed to generate image');
        }

        if (this.canvas) {
            const node = await this.canvas.createImageNode(
                result.url,
                prompt,
                result.analysis
            );

            if (node.isEmptyFrame && result.url) {
                await node.convertToGenerationNode(
                    result.url,
                    prompt,
                    result.analysis
                );
                node.updateConnections();
            }

            if (this.promptInput) {
                this.promptInput.value = '';
            }

            this.updateGenerateButton();
            this.showSuccess('Image generated successfully');
        }
    } catch (error) {
        console.error('Generation error:', error);
        this.showError(error.message || 'Failed to generate image');
    } finally {
        this.setLoading(false);
        this.isGenerating = false;
        this.updateGenerateButton();
        this.enableInteractions();
    }
}

canGenerate() {
    const prompt = this.promptInput?.value.trim();
    return !this.isGenerating && !this.isProcessing && prompt && prompt.length > 0;
}

updateGenerateButton() {
    if (this.generateBtn) {
        const canGenerate = this.canGenerate();
        this.generateBtn.disabled = !canGenerate;
    }
}
    disableInteractions() {
        if (!this.validateState()) return;
        const elements = document.querySelectorAll('button, input, .node, .attribute-point');
        elements.forEach(el => {
            if (!el.closest('.loading')) {
                el.disabled = true;
                el.style.pointerEvents = 'none';
            }
        });
    }
    enableInteractions() {
        if (!this.validateState()) return;
        const elements = document.querySelectorAll('button, input, .node, .attribute-point');
        elements.forEach(el => {
            el.disabled = false;
            el.style.pointerEvents = 'auto';
        });
        if (this.canvas) {
            this.canvas.nodes.forEach(node => node.tryRecover());
        }
    }
    validateState() {
        try {
            if (!this.canvas) {
                throw new Error('Canvas not initialized');
            }
            return true;
        } catch (error) {
            console.error('State validation failed:', error);
            return false;
        }
    }
    _handleEmptyFrame() {
        if (this.isProcessing || !this.canvas) {
            console.warn('Cannot create empty frame: canvas not ready or processing');
            return;
        }
        try {
            console.log('Creating empty frame');
            const container = document.querySelector('.canvas-container');
            if (!container) {
                throw new Error('Canvas container not found');
            }
            const position = this.getRandomPosition(container);
            const node = this.canvas.addEmptyFrame(position.x, position.y);
            if (!node) {
                throw new Error('Failed to create empty frame node');
            }
            return node;
        } catch (error) {
            console.error('Empty frame error:', error);
            this.showNotification('Failed to create empty frame', 'error');
        }
    }
    getRandomPosition(container) {
        const margin = 50;
        const nodeSize = 256;
        const width = container.offsetWidth - nodeSize - margin * 2;
        const height = container.offsetHeight - nodeSize - margin * 2;
        return {
            x: margin + Math.random() * Math.max(0, width),
            y: margin + Math.random() * Math.max(0, height)
        };
    }
    handleClear() {
        if (this.isProcessing || !this.canvas) return;
        if (confirm('Are you sure you want to clear the canvas? This action cannot be undone.')) {
            this.canvas.clear();
        }
    }
    handleUndo() {
        if (!this.isProcessing && this.canvas) {
            this.canvas.undo();
        }
    }
    handleRedo() {
        if (!this.isProcessing && this.canvas) {
            this.canvas.redo();
        }
    }
    handleToggleAttributes() {
        if (!this.isProcessing && this.canvas) {
            this.canvas.toggleAllAttributes();
        }
    }
    handleAutoLayout() {
        if (!this.isProcessing && this.canvas) {
            this.canvas.autoLayoutNodes();
        }
    }
    handleCenterView() {
        if (!this.isProcessing && this.canvas) {
            this.canvas.centerView();
        }
    }
    handlePromptInput() {
        this.updateGenerateButton();
    }
    handlePromptKeydown(event) {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            this.handleGenerate();
        }
    }
    handleSettingsChange() {
        const settings = {
            model: this.settings.model?.value || 'dall-e-2',
            size: this.settings.size?.value || '512x512',
            quality: this.settings.quality?.value || 'standard'
        };
        this.currentSettings = settings;
        if (this.canvas) {
            this.canvas.updateGenerationSettings(settings);
        }
    }
    handleHistoryUpdate(event) {
        const { canUndo, canRedo } = event.detail;
        if (this.toolbar.undo) this.toolbar.undo.disabled = !canUndo;
        if (this.toolbar.redo) this.toolbar.redo.disabled = !canRedo;
    }
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
    setLoading(loading, message = '') {
        if (!this.loadingElement || !this.validateState()) return;
        this.isProcessing = loading;
        this.loadingElement.style.display = loading ? 'flex' : 'none';
        if (this.loadingText) {
            this.loadingText.textContent = message;
        }
        this.updateButtonStates(loading);
    }
    updateGenerateButton() {
        if (this.generateBtn) {
            const hasText = this.promptInput?.value.trim().length > 0;
            this.generateBtn.disabled = !hasText || this.isGenerating;
        }
    }
    updateButtonStates(disabled = false) {
        if (this.generateBtn) {
            const hasText = this.promptInput?.value.trim().length > 0;
            this.generateBtn.disabled = disabled || !hasText || this.isGenerating;
        }
        if (this.emptyFrameBtn) {
            this.emptyFrameBtn.disabled = disabled;
        }
        Object.values(this.toolbar || {}).forEach(button => {
            if (button) {
                button.disabled = disabled;
            }
        });
    }
    getRandomPosition() {
        const canvas = document.querySelector('.canvas-container');
        const margin = 50;
        const width = canvas.offsetWidth - 256 - margin * 2;
        const height = canvas.offsetHeight - 256 - margin * 2;
        return {
            x: margin + Math.random() * width,
            y: margin + Math.random() * height
        };
    }
    showError(message) {
        console.error(message);
        this.showNotification(message, 'error');
    }
    showSuccess(message) {
        this.showNotification(message, 'success');
    }
    showNotification(message, type = 'info') {
        if (!message) return;
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        const existingNotification = document.querySelector(`.notification[data-message="${message}"]`);
        if (existingNotification) {
            existingNotification.remove();
        }
        notification.dataset.message = message;
        document.body.appendChild(notification);
        requestAnimationFrame(() => {
            notification.classList.add('visible');
        });
        setTimeout(() => {
            notification.classList.remove('visible');
            notification.addEventListener('transitionend', () => {
                if (notification.parentNode) {
                    notification.remove();
                }
            }, { once: true });
        }, 3000);
    }
    handleError(error, context) {
        console.error(`Error in ${context}:`, error);
        const message = error.message || 'An unexpected error occurred';
        this.showNotification(message, 'error');
        this.isProcessing = false;
        this.isGenerating = false;
        this.updateButtonStates();
    }
    destroy() {
        try {
            if (this.emptyFrameBtn) {
                this.emptyFrameBtn.removeEventListener('click', this.handleEmptyFrame);
            }
            Object.values(this.toolbar || {}).forEach(button => {
                if (button) {
                    button.removeEventListener('click', () => {});
                }
            });
            if (this.promptInput) {
                this.promptInput.removeEventListener('input', () => {});
                this.promptInput.removeEventListener('keydown', () => {});
            }
            Object.values(this.settings || {}).forEach(select => {
                if (select) {
                    select.removeEventListener('change', () => {});
                }
            });
            document.removeEventListener('historyUpdated', () => {});
            if (this.canvas) {
                this.canvas.destroy();
                this.canvas = null;
            }
            window.controlsInstance = null;
        } catch (error) {
            console.error('Error during cleanup:', error);
            throw error;
        }
    }
}
export default Controls;