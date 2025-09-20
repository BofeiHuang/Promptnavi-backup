class ApiService {
    constructor() {
        this.baseUrl = '/api';
        this.cache = new Map();
        this.cacheTimeout = 5 * 60 * 1000;
    }

    async proxyImage(imageUrl) {
        try {
            const response = await fetch(`${this.baseUrl}/proxy-image`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ url: imageUrl })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            return data;

        } catch (error) {
            console.error('Image proxy error:', error);
            throw error;
        }
    }

    async generateImage(prompt, options = {}) {
    try {
        console.log('Generating image with prompt:', prompt);

        const modelSelect = document.getElementById('model-select');
        const sizeSelect = document.getElementById('size-select');
        const selectedModel = modelSelect ? modelSelect.value : 'dall-e-2';
        const selectedSize = sizeSelect ? sizeSelect.value : '1024x1024';

        const response = await fetch(`${this.baseUrl}/generate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                prompt,
                model: options.model || selectedModel,
                size: options.size || selectedSize,
                quality: options.quality || 'standard'
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error || 'Failed to generate image');
        }

        return data;

    } catch (error) {
        console.error('Generate image error:', error);

        return {
            success: false,
            error: error.message || 'Failed to generate image',
            details: error
        };
    }
}

    validateMethods() {
        const requiredMethods = this.constructor.REQUIRED_METHODS;
        requiredMethods.forEach(method => {
            if (typeof this[method] !== 'function') {
                throw new Error(`Missing required method: ${method}`);
            }
        });
    }

    async interpolate(features, weights) {
        try {
            const response = await this._request('interpolate', {
                features,
                weights
            });

            return this._handleResponse(response);
        } catch (error) {
            return this._handleError('Interpolate error:', error);
        }
    }

    async analyzeFeatures(prompt, imageData = null) {
        try {
            const cacheKey = `analyze_${prompt}_${imageData ? 'with_image' : 'no_image'}`;
            const cachedResult = this._getFromCache(cacheKey);
            if (cachedResult) return cachedResult;

            const response = await fetch(`${this.baseUrl}/analyze`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    prompt,
                    image_data: imageData
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            if (!data.success) {
                throw new Error(data.error || 'Analysis failed');
            }


            this._addToCache(cacheKey, data);
            return data;

        } catch (error) {
            console.error('Analysis error:', error);
            throw error;
        }
    }







    async getAvailableFeatures() {
        try {
            const cacheKey = 'available_features';
            const cachedResult = this._getFromCache(cacheKey);
            if (cachedResult) return cachedResult;

            const response = await this._request('features/available', {}, 'GET');
            const result = await this._handleResponse(response);
            this._addToCache(cacheKey, result);
            return result;
        } catch (error) {
            return this._handleError('Get features error:', error);
        }
    }

    async enhancePrompt(prompt) {
        try {
            const cacheKey = `enhance_${prompt}`;
            const cachedResult = this._getFromCache(cacheKey);
            if (cachedResult) return cachedResult;

            const response = await this._request('enhance', {
                prompt
            });

            const result = await this._handleResponse(response);
            this._addToCache(cacheKey, result);
            return result;
        } catch (error) {
            return this._handleError('Enhance prompt error:', error);
        }
    }

    async _request(endpoint, data = {}, method = 'POST') {
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        if (method === 'POST') {
            options.body = JSON.stringify(data);
        }

        const response = await fetch(`${this.baseUrl}/${endpoint}`, options);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        return response;
    }

    async _handleResponse(response) {
        try {
            const data = await response.json();
            if (!data.success) {
                throw new Error(data.error || 'Operation failed');
            }
            return data;
        } catch (error) {
            throw new Error(error.message || 'Failed to process response');
        }
    }

    _handleError(message, error) {
        console.error(message, error);
        return {
            success: false,
            error: error.message || 'Operation failed'
        };
    }

    _getFromCache(key) {
        const cached = this.cache.get(key);
        if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
            return cached.data;
        }
        this.cache.delete(key);
        return null;
    }

    _addToCache(key, data) {
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
    }
}

const apiService = new ApiService();
export default apiService;