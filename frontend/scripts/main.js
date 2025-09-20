import api from './api.js';
import Node from './node.js';
import Canvas from './canvas.js';
import Controls from './controls.js';



const APP_CONFIG = {
    features: {
        minRequiredConnections: 2,
        maxConnections: 5,
        analysisThreshold: 0.3
    },
    canvas: {
        nodeSpacing: 50,
        maxNodesVisible: 20
    },
    connections: {
        minRequired: 2,
        maxAllowed: 5
    }
};

class App {
    constructor() {
        try {
            console.log('Initializing application...');

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.init());
            } else {
                this.init();
            }
        } catch (error) {
            console.error('Error initializing application:', error);
            this.showError('Failed to initialize application');
        }
    }

    init() {
        this.validateRequiredElements();

        this.controls = new Controls();

        window.addEventListener('unhandledrejection', this.handleUnhandledRejection.bind(this));

        console.log('Application initialized successfully');
    }

    validateRequiredElements() {
        const required = [
            '#canvas-container',
            '#empty-frame-btn',
            '#generate-btn',
            '#prompt-input'
        ];

        const missing = required.filter(selector => !document.querySelector(selector));
        if (missing.length > 0) {
            throw new Error(`Missing required elements: ${missing.join(', ')}`);
        }
    }

    handleError(error, context) {
        console.error(`Error in ${context}:`, error);

        const message = error.message || 'An unexpected error occurred';
        this.showNotification(message, 'error');

        this.isProcessing = false;
        this.isGenerating = false;

        this.updateButtonStates();
    }

    handleUnhandledRejection(event) {
        console.error('Unhandled promise rejection:', event.reason);
        this.showError('An unexpected error occurred');
    }

    validateMethods() {
        const requiredMethods = this.constructor.REQUIRED_METHODS;
        requiredMethods.forEach(method => {
            if (typeof this[method] !== 'function') {
                throw new Error(`Missing required method: ${method}`);
            }
        });
    }

    showError(message) {
        const notification = document.createElement('div');
        notification.className = 'notification error';
        notification.textContent = message;
        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 3000);
    }
}

let controlsInstance = null;

document.addEventListener('DOMContentLoaded', () => {
    if (!document.querySelector('#connection-container')) {
        const container = document.createElement('div');
        container.id = 'connection-container';
        document.body.appendChild(container);
        console.log('Parent container initialized.');
    }
});



export default App;