class Connection {
    constructor(sourceNode, targetNode, type, sourcePoint, targetPoint) {
        console.log('Creating new connection:', {
            sourceNodeId: sourceNode?.id,
            targetNodeId: targetNode?.id,
            type
        });
        this.id = `conn-${Date.now()}`;
        this.sourceNode = sourceNode;
        this.targetNode = targetNode;
        this.type = type;
        this.sourcePoint = sourcePoint;
        this.targetPoint = targetPoint;
        this.value = 0.5;
        this.isControlVisible = false;
        this._autoHideTimer = null;
        this.isExpanded = true;
        this.isFolded = false;
        this.isMain = false;
        this.isHidden = false;
        this.isDestroyed = false;
        this._lastValidPath = null;
        this.element = null;
        this._boundHandlers = {};
        if (sourceNode && !sourceNode.connectedFeatures.has(type)) {
            sourceNode.connectedFeatures.set(type, []);
        }
        if (targetNode && !targetNode.connectedFeatures.has(type)) {
            targetNode.connectedFeatures.set(type, []);
        }
        const connectionData = {
            connection: this,
            sourceNode,
            targetNode,
            weight: 0.5,
            features: {},
            sourcePoint,
            targetPoint
        };
        if (sourceNode) {
            sourceNode.connectedFeatures.get(type).push(connectionData);
        }
        if (targetNode) {
            targetNode.connectedFeatures.get(type).push(connectionData);
        }
        try {
            this.element = this.createElement();
            if (!this.element) {
                throw new Error('Failed to create connection element');
            }
            this.element.__instance__ = this;
            this.svgElement = this.element.querySelector('svg');
            this.pathElement = this.element.querySelector('.connection-line');
            this.hitArea = this.element.querySelector('.connection-hit-area');
            this.sliderContainer = this.element.querySelector('.connection-slider-container');
            this.slider = this.element.querySelector('.connection-slider');
            this.valueDisplay = this.element.querySelector('.connection-value');
            this.weightIndicator = this.element.querySelector('.connection-weight-indicator');
            this.gradientElement = this.element.querySelector(`#gradient-${this.id}`);
            this.boundUpdatePosition = this.updatePosition.bind(this);
            this.boundHandleDocumentClick = this.handleDocumentClick.bind(this);
            this.boundHandleSliderChange = this.handleSliderChange.bind(this);
            const container = document.querySelector('.canvas-container');
            if (!container) {
                throw new Error('Canvas container not found');
            }
            Object.assign(this.element.style, {
                position: 'absolute',
                top: '0',
                left: '0',
                width: '100%',
                height: '100%',
                zIndex: '5',
                pointerEvents: 'auto',
                transition: 'opacity 0.3s ease'
            });
            container.appendChild(this.element);
            this.setupEventListeners();
            this.setupGradient();
            this.updatePosition();
            this.updateVisuals();
            requestAnimationFrame(() => {
                this.setupGradient();
                this.updatePosition();
                this.updateVisuals();
            });
        } catch (error) {
            console.error('Connection initialization failed:', error);
            this.cleanup();
            throw error;
        }
    }
    updatePosition() {
        if (!this.element || this.isDestroyed) return;
        try {
          const container = document.querySelector('.canvas-container');
          if (!container) {
            console.warn('[Connection] updatePosition: .canvas-container not found');
            return;
          }
          const containerRect = container.getBoundingClientRect();
          if (!this.sourcePoint || !this.targetPoint) {
            console.warn('[Connection] updatePosition: missing sourcePoint/targetPoint');
            return;
          }
          const sourceRect = this.sourcePoint.getBoundingClientRect();
          const targetRect = this.targetPoint.getBoundingClientRect();
          const sourcePos = {
            x: sourceRect.left + sourceRect.width / 2,
            y: sourceRect.top + sourceRect.height / 2
          };
          const targetPos = {
            x: targetRect.left + targetRect.width / 2,
            y: targetRect.top + targetRect.height / 2
          };
          this.sourcePos = sourcePos;
          this.targetPos = targetPos;
          const relSourceX = sourcePos.x - containerRect.left;
          const relSourceY = sourcePos.y - containerRect.top;
          const relTargetX = targetPos.x - containerRect.left;
          const relTargetY = targetPos.y - containerRect.top;
          const dx = relTargetX - relSourceX;
          const dy = relTargetY - relSourceY;
          const distance = Math.sqrt(dx * dx + dy * dy);
          const curvature = Math.min(0.3, 100 / distance);
          const cp1 = {
            x: relSourceX + dx * curvature,
            y: relSourceY + dy * 0.2
          };
          const cp2 = {
            x: relTargetX - dx * curvature,
            y: relTargetY - dy * 0.2
          };
          const pathData = `
            M ${relSourceX},${relSourceY}
            C ${cp1.x},${cp1.y}
              ${cp2.x},${cp2.y}
              ${relTargetX},${relTargetY}
          `;
          if (this.pathElement) {
            this.pathElement.setAttribute('d', pathData.trim());
          }
          if (this.hitArea) {
            this.hitArea.setAttribute('d', pathData.trim());
          }
          if (this.isControlVisible) {
            this.updateControlPosition();
          }
        } catch (error) {
          console.error('[Connection] updatePosition error:', error);
        }
      }
    getConnectionPoints() {
        if (!this.sourceNode || !this.targetNode) return null;
        try {
            let sourcePoint, targetPoint;
            if (this.sourceNode.isAttributesFolded) {
                sourcePoint = this.sourceNode.element.querySelector('.attributes-output-point');
            } else {
                sourcePoint = this.sourcePoint;
            }
            if (this.targetNode.isAttributesFolded) {
                targetPoint = this.targetNode.element.querySelector('.attributes-input-point');
            } else {
                targetPoint = this.targetPoint;
            }
            if (!sourcePoint || !targetPoint) {
                console.warn('Connection points not found:', {
                    sourcePoint: !!sourcePoint,
                    targetPoint: !!targetPoint
                });
                return null;
            }
            return { sourcePoint, targetPoint };
        } catch (error) {
            console.error('Error getting connection points:', error);
            return null;
        }
    }
    createElement() {
        try {
            const container = document.createElement('div');
            container.className = `connection ${this.type}`;
            Object.assign(container.style, {
                position: 'absolute',
                top: '0',
                left: '0',
                width: '100%',
                height: '100%',
                zIndex: '5',
                pointerEvents: 'none',
                transition: 'opacity 0.3s ease'
            });
            const uniqueId = `gradient-${this.id}-${Date.now()}`;
            container.innerHTML = `
            <svg class="connection-path" xmlns="http://www.w3.org/2000/svg"
                 style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;
                        overflow: visible; pointer-events: none;">
                <defs>
                    <linearGradient id="${uniqueId}" gradientUnits="userSpaceOnUse">
                        <stop offset="0%" class="gradient-start"
                              stop-color="var(--feature-${this.type}-dark)"/>
                        <stop offset="100%" class="gradient-end"
                              stop-color="var(--feature-${this.type}-base)"/>
                    </linearGradient>
                </defs>
                <path class="connection-hit-area"
                      stroke-width="20"
                      stroke="transparent"
                      fill="none"
                      style="pointer-events: stroke;"/>
                <path class="connection-line"
                      stroke="url(#${uniqueId})"
                      stroke-width="2"
                      fill="none"
                      style="pointer-events: none;
                             transition: all 0.3s ease;"/>
            </svg>
            <div class="connection-slider-container"
                 style="display: none; position: absolute; background: white;
                        padding: 8px 16px; border-radius: 20px;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                <div class="connection-weight-indicator"
                     style="height: 4px; border-radius: 2px;
                            background: var(--feature-${this.type}-base);
                            transition: width 0.2s ease;"></div>
                <input type="range" class="connection-slider"
                       min="10" max="100" value="50"
                       style="width: 100px; margin: 0 8px;">
                <div class="connection-value"
                     style="min-width: 40px; text-align: center;">50%</div>
            </div>
        `;
            this.svgElement = container.querySelector('svg');
            this.pathElement = container.querySelector('.connection-line');
            this.hitArea = container.querySelector('.connection-hit-area');
            this.sliderContainer = container.querySelector('.connection-slider-container');
            this.slider = container.querySelector('.connection-slider');
            this.valueDisplay = container.querySelector('.connection-value');
            this.weightIndicator = container.querySelector('.connection-weight-indicator');
            this.gradientElement = container.querySelector(`#${uniqueId}`);
            if (this.hitArea) {
                this.hitArea.addEventListener('mouseenter', () => {
                    if (!this.isDestroyed) {
                        container.style.pointerEvents = 'auto';
                        container.classList.add('hover');
                        this.pathElement.style.strokeWidth = '3px';
                        this.pathElement.style.filter = 'drop-shadow(0 0 2px var(--feature-${this.type}-base))';
                    }
                });
                this.hitArea.addEventListener('mouseleave', () => {
                    if (!this.isDestroyed && !this.isControlVisible) {
                        container.style.pointerEvents = 'none';
                        container.classList.remove('hover');
                        this.pathElement.style.strokeWidth = '2px';
                        this.pathElement.style.filter = 'none';
                    }
                });
                this.hitArea.addEventListener('click', (e) => {
                    if (!this.isDestroyed) {
                        this.toggleControls();
                        e.stopPropagation();
                    }
                });
                this.hitArea.addEventListener('dblclick', (e) => {
                    if (!this.isDestroyed) {
                        this.toggleFold();
                        e.stopPropagation();
                    }
                });
            }
            if (this.slider) {
                this.slider.addEventListener('input', (e) => {
                    const value = e.target.value / 100;
                    this.setValue(value);
                });
                this.slider.addEventListener('change', () => {
                    this.dispatchEvent('connectionWeightFinalized', {
                        connection: this,
                        value: this.value
                    });
                });
            }
            document.addEventListener('click', (e) => {
                if (this.isControlVisible &&
                    !container.contains(e.target) &&
                    !this.sliderContainer.contains(e.target)) {
                    this.hideControls();
                }
            });
            if (!this.svgElement || !this.pathElement || !this.hitArea ||
                !this.sliderContainer || !this.slider || !this.valueDisplay ||
                !this.weightIndicator || !this.gradientElement) {
                throw new Error('Failed to create all required elements');
            }
            return container;
        } catch (error) {
            console.error('Error creating connection element:', error);
            throw error;
        }
    }
    removeElement() {
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        } else if (this.element) {
            this.element.remove();
        }
        this.element = null;
    }
    setupEventListeners() {
        if (!this.element) {
            console.error('Cannot setup event listeners: element is null');
            return;
        }
        try {
            this._boundHandlers = {
                handleResize: () => {
                    requestAnimationFrame(() => this.updatePosition());
                },
                handleNodeMove: () => {
                    requestAnimationFrame(() => this.updatePosition());
                },
                handleSliderInput: (e) => {
                    const value = e.target.value / 100;
                    this.setValue(value);
                },
                handleSliderChange: () => {
                    this.dispatchEvent('connectionWeightFinalized', {
                        connection: this,
                        value: this.value
                    });
                },
                handleMouseEnter: () => {
                    if (!this.isDestroyed) {
                        this.element.classList.add('hover');
                        if (this.isFolded) {
                            this.showFoldedPreview();
                        }
                    }
                },
                handleMouseLeave: () => {
                    if (!this.isDestroyed) {
                        this.element.classList.remove('hover');
                        if (this.isFolded) {
                            this.hideFoldedPreview();
                        }
                    }
                },
                handleHitAreaClick: (e) => {
                    if (!this.isDestroyed && e.target === this.hitArea) {
                        this.toggleControls();
                    }
                },
                handleHitAreaDoubleClick: (e) => {
                    if (!this.isDestroyed && e.target === this.hitArea) {
                        this.toggleFold();
                    }
                },
                handleDocumentClick: (e) => {
                    if (!this.isDestroyed && this.isControlVisible &&
                        !this.element.contains(e.target) &&
                        !this.sliderContainer.contains(e.target)) {
                        this.hideControls();
                    }
                }
            };
            window.addEventListener('resize', this._boundHandlers.handleResize);
            if (this.sourceNode?.element) {
                this.sourceNode.element.addEventListener('nodeMoved',
                    this._boundHandlers.handleNodeMove);
            }
            if (this.targetNode?.element) {
                this.targetNode.element.addEventListener('nodeMoved',
                    this._boundHandlers.handleNodeMove);
            }
            if (this.slider) {
                this.slider.addEventListener('input', this._boundHandlers.handleSliderInput);
                this.slider.addEventListener('change', this._boundHandlers.handleSliderChange);
            }
            this.element.addEventListener('mouseenter', this._boundHandlers.handleMouseEnter);
            this.element.addEventListener('mouseleave', this._boundHandlers.handleMouseLeave);
            this.element.addEventListener('click', this._boundHandlers.handleHitAreaClick);
            this.element.addEventListener('dblclick', this._boundHandlers.handleHitAreaDoubleClick);
            document.addEventListener('click', this._boundHandlers.handleDocumentClick);
            if (this.sourcePoint && this.targetPoint) {
                this.sourcePoint.addEventListener('mouseenter', () => {
                    if (!this.isDestroyed) this.element.classList.add('preview');
                });
                this.sourcePoint.addEventListener('mouseleave', () => {
                    if (!this.isDestroyed) this.element.classList.remove('preview');
                });
                this.targetPoint.addEventListener('mouseenter', () => {
                    if (!this.isDestroyed) this.element.classList.add('preview');
                });
                this.targetPoint.addEventListener('mouseleave', () => {
                    if (!this.isDestroyed) this.element.classList.remove('preview');
                });
            }
            this.cleanup = () => {
                window.removeEventListener('resize', this._boundHandlers.handleResize);
                if (this.sourceNode?.element) {
                    this.sourceNode.element.removeEventListener('nodeMoved',
                        this._boundHandlers.handleNodeMove);
                }
                if (this.targetNode?.element) {
                    this.targetNode.element.removeEventListener('nodeMoved',
                        this._boundHandlers.handleNodeMove);
                }
                if (this.slider) {
                    this.slider.removeEventListener('input', this._boundHandlers.handleSliderInput);
                    this.slider.removeEventListener('change', this._boundHandlers.handleSliderChange);
                }
                this.element.removeEventListener('mouseenter', this._boundHandlers.handleMouseEnter);
                this.element.removeEventListener('mouseleave', this._boundHandlers.handleMouseLeave);
                this.element.removeEventListener('click', this._boundHandlers.handleHitAreaClick);
                this.element.removeEventListener('dblclick', this._boundHandlers.handleHitAreaDoubleClick);
                document.removeEventListener('click', this._boundHandlers.handleDocumentClick);
                if (this.sourcePoint) {
                    this.sourcePoint.removeEventListener('mouseenter', () => {});
                    this.sourcePoint.removeEventListener('mouseleave', () => {});
                }
                if (this.targetPoint) {
                    this.targetPoint.removeEventListener('mouseenter', () => {});
                    this.targetPoint.removeEventListener('mouseleave', () => {});
                }
                this._boundHandlers = null;
            };
        } catch (error) {
            console.error('Error setting up event listeners:', error);
            throw error;
        }
    }
    toggleFold() {
        this.isFolded = !this.isFolded;
        this.element.classList.toggle('folded', this.isFolded);
        this.updateVisuals();
        this.dispatchEvent('connectionFoldChanged', {
            isFolded: this.isFolded
        });
    }
    showFoldedPreview() {
        if (!this.element || this.isDestroyed) return;
        this.element.classList.add('preview');
        this.element.style.pointerEvents = 'auto';
        const pathElement = this.element.querySelector('.connection-line');
        if (pathElement) {
            pathElement.style.strokeDasharray = 'none';
            pathElement.style.opacity = '1';
        }
        this._previewTimeout = setTimeout(() => {
            this.hideFoldedPreview();
        }, 300);
        this.dispatchEvent('connectionPreviewStart');
     }
     hideFoldedPreview() {
        if (!this.element || this.isDestroyed) return;
        this.element.classList.remove('preview');
        this.element.style.pointerEvents = 'none';
        const pathElement = this.element.querySelector('.connection-line');
        if (pathElement) {
            pathElement.style.strokeDasharray = this.isFolded ? '4,4' : 'none';
            pathElement.style.opacity = this.isFolded ? '0.7' : '1';
        }
        if (this._previewTimeout) {
            clearTimeout(this._previewTimeout);
            this._previewTimeout = null;
        }
        const canvas = document.querySelector('.canvas-container');
        if (canvas) {
            canvas.style.pointerEvents = 'auto';
        }
        this.dispatchEvent('connectionPreviewEnd');
     }
     handleConnectionPreviewEnd() {
        console.log(`[Connection ${this.id}] Handling preview end`);
        if (this.isDestroyed) {
            console.log('Connection destroyed, skipping preview end handling');
            return;
        }
        try {
            requestAnimationFrame(() => {
                this.element.classList.remove('preview', 'hover');
                this.element.style.pointerEvents = 'none';
                const hitArea = this.element.querySelector('.connection-hit-area');
                if (hitArea) {
                    hitArea.style.pointerEvents = 'none';
                }
                if (this.pathElement) {
                    Object.assign(this.pathElement.style, {
                        strokeDasharray: this.isFolded ? '4,4' : 'none',
                        // strokeWidth: this.isMain ? '4px' : '2px',
                        opacity: this.isFolded ? '0.7' : '1',
                        transition: 'all 0.3s ease'
                    });
                }
                if (this.sliderContainer) {
                    this.sliderContainer.style.display = 'none';
                }
                this.updatePosition();
            });
            if (this._previewCleanup) {
                this._previewCleanup();
                this._previewCleanup = null;
            }
            console.log(`[Connection ${this.id}] Preview end handled successfully`);
        } catch (error) {
            console.error('Error handling preview end:', error);
        }
     }
    setupGradient() {
        if (!this.gradientElement) {
            console.warn('Gradient element not found');
            return;
        }
        try {
            const baseColor = getComputedStyle(document.documentElement)
                .getPropertyValue(`--feature-${this.type}-base`).trim();
            const darkColor = getComputedStyle(document.documentElement)
                .getPropertyValue(`--feature-${this.type}-dark`).trim();
            const startStop = this.gradientElement.querySelector('.gradient-start') ||
                document.createElementNS('http://www.w3.org/2000/svg', 'stop');
            const endStop = this.gradientElement.querySelector('.gradient-end') ||
                document.createElementNS('http://www.w3.org/2000/svg', 'stop');
            startStop.setAttribute('offset', '0%');
            startStop.setAttribute('stop-color', darkColor);
            startStop.setAttribute('class', 'gradient-start');
            endStop.setAttribute('offset', '100%');
            endStop.setAttribute('stop-color', baseColor);
            endStop.setAttribute('class', 'gradient-end');
            if (!startStop.parentNode) {
                this.gradientElement.appendChild(startStop);
            }
            if (!endStop.parentNode) {
                this.gradientElement.appendChild(endStop);
            }
            if (this.pathElement) {
                this.pathElement.setAttribute('stroke', `url(#gradient-${this.id})`);
            }
        } catch (error) {
            console.error('Error setting up gradient:', error);
            if (this.pathElement) {
                this.pathElement.setAttribute('stroke', `var(--feature-${this.type}-base)`);
            }
        }
    }
    handleInvalidPosition() {
        try {
            if (this._lastValidPath && this.pathElement) {
                console.log('Using last valid path as fallback');
                this.pathElement.setAttribute('d', this._lastValidPath);
                return true;
            }
            if (this.sliderContainer) {
                this.sliderContainer.style.visibility = 'hidden';
            }
            if (this.element) {
                this.element.classList.add('position-error');
                setTimeout(() => {
                    if (this.element) {
                        this.element.classList.remove('position-error');
                    }
                }, 3000);
            }
            if (!this.sourceNode || !this.targetNode) {
                console.warn('Nodes missing during invalid position handling');
                this.destroy();
                return false;
            }
            return this.scheduleRetry();
        } catch (error) {
            console.error('Error handling invalid position:', error);
            this.destroy();
            return false;
        }
    }
    handleUpdateError(error) {
        try {
            if (this.isDestroyed) {
                console.log('Connection is destroyed, stopping error handling');
                return false;
            }
            console.error('Connection update error:', error);
            if (this._lastValidPath && this.pathElement) {
                this.pathElement.setAttribute('d', this._lastValidPath);
            }
            if (this.sliderContainer) {
                this.sliderContainer.style.visibility = 'hidden';
            }
            if (error.message.includes('null') || error.message.includes('undefined')) {
                if (!this.sourceNode || !this.targetNode) {
                    console.warn('Node reference lost, destroying connection');
                    this.destroy();
                    return false;
                }
            }
            if (this.element) {
                this.element.classList.add('error');
                setTimeout(() => {
                    if (this.element) {
                        this.element.classList.remove('error');
                    }
                }, 3000);
            }
            return this.scheduleRetry();
        } catch (retryError) {
            console.error('Error in handleUpdateError:', retryError);
            this.destroy();
            return false;
        }
    }
    handleUpdateError() {
        if (this._lastValidPath && this.pathElement) {
            this.pathElement.setAttribute('d', this._lastValidPath);
        }
        if (this.sliderContainer) {
            this.sliderContainer.style.visibility = 'hidden';
        }
        this.element.classList.add('error');
        this.scheduleRetry();
        setTimeout(() => {
            this.element.classList.remove('error');
        }, 2000);
    }
    updateSVGElements(path) {
        if (this.pathElement) {
            this.pathElement.setAttribute('d', path);
            const baseWidth = this.isMain ? '4px' : '2px';
            const opacity = this.isFolded ? '0.7' : '1';
            const dashArray = this.isFolded ? '8,4' : 'none';
            Object.assign(this.pathElement.style, {
                //strokeWidth: baseWidth,
               // strokeDasharray: dashArray,
                //opacity: opacity,
                transition: 'all 0.3s ease'
            });
        }
        if (this.hitArea) {
            this.hitArea.setAttribute('d', path);
            Object.assign(this.hitArea.style, {
                // strokeWidth: '20px',
                stroke: 'transparent',
                fill: 'none',
                pointerEvents: 'stroke'
            });
        }
        if (this.gradientElement) {
            this.updateGradient();
        }
    }
    validatePositions(sourcePos, targetPos) {
        try {
            if (!sourcePos || !targetPos) {
                console.warn('Invalid position objects');
                return false;
            }
            const coordinates = [
                sourcePos.x, sourcePos.y,
                targetPos.x, targetPos.y
            ];
            if (coordinates.some(coord => !Number.isFinite(coord))) {
                console.warn('Invalid coordinate values:', { sourcePos, targetPos });
                return false;
            }
            const canvas = this.element.parentElement;
            if (!canvas) {
                console.warn('Canvas container not found');
                return false;
            }
            const canvasWidth = canvas.offsetWidth;
            const canvasHeight = canvas.offsetHeight;
            const bounds = {
                minX: -canvasWidth * 0.5,
                maxX: canvasWidth * 1.5,
                minY: -canvasHeight * 0.5,
                maxY: canvasHeight * 1.5
            };

            const isWithinBounds = coordinates.every(coord =>
                coord >= Math.min(bounds.minX, bounds.minY) &&
                coord <= Math.max(bounds.maxX, bounds.maxY)
            );
            if (!isWithinBounds) {
                console.warn('Coordinates outside extended bounds');
                return false;
            }
            const distance = Math.sqrt(
                Math.pow(targetPos.x - sourcePos.x, 2) +
                Math.pow(targetPos.y - sourcePos.y, 2)
            );
            const maxDistance = Math.sqrt(
                Math.pow(canvasWidth * 2, 2) +
                Math.pow(canvasHeight * 2, 2)
            );
            if (distance > maxDistance) {
                console.warn('Connection distance exceeds maximum');
                return false;
            }
            return true;
        } catch (error) {
            console.error('Error validating positions:', error);
            return false;
        }
    }
    _handleInvalidPosition() {
        try {
            if (this._lastValidPath && this.pathElement) {
                console.log('Using last valid path as fallback');
                this.pathElement.setAttribute('d', this._lastValidPath);
                return true;
            }
            if (this.sliderContainer) {
                this.sliderContainer.style.visibility = 'hidden';
            }
            if (this.element) {
                this.element.classList.add('position-error');
                setTimeout(() => {
                    if (this.element) {
                        this.element.classList.remove('position-error');
                    }
                }, 3000);
            }
            if (!this.sourceNode || !this.targetNode) {
                console.warn('Nodes missing during invalid position handling');
                this.destroy();
                return false;
            }
            return this.scheduleRetry();
        } catch (error) {
            console.error('Error handling invalid position:', error);
            this.destroy();
            return false;
        }
    }
    updateControlPosition(sourceX, sourceY, targetX, targetY) {
        if (!this.sliderContainer) return;
        try {
            const midX = (sourceX + targetX) / 2;
            const midY = (sourceY + targetY) / 2;
            const angle = Math.atan2(targetY - sourceY, targetX - sourceX) * (180 / Math.PI);
            const containerWidth = this.sliderContainer.offsetWidth;
            const containerHeight = this.sliderContainer.offsetHeight;
            let offsetX = 0;
            let offsetY = -containerHeight / 2;
            const canvas = this.element.parentElement;
            const canvasRect = canvas.getBoundingClientRect();
            let finalX = midX;
            let finalY = midY;
            if (finalX - containerWidth/2 < 0) {
                finalX = containerWidth/2;
            } else if (finalX + containerWidth/2 > canvasRect.width) {
                finalX = canvasRect.width - containerWidth/2;
            }
            if (finalY - containerHeight/2 < 0) {
                finalY = containerHeight/2;
            } else if (finalY + containerHeight/2 > canvasRect.height) {
                finalY = canvasRect.height - containerHeight/2;
            }
            Object.assign(this.sliderContainer.style, {
                left: `${finalX + offsetX}px`,
                top: `${finalY + offsetY}px`,
                transform: `translate(-50%, -50%) rotate(${angle}deg)`,
                visibility: 'visible',
                pointerEvents: 'auto'
            });
        } catch (error) {
            console.error('Error updating control position:', error);
            this.sliderContainer.style.visibility = 'hidden';
        }
    }
    validateCoordinates(x1, y1, x2, y2) {
        try {
            const coordinates = [x1, y1, x2, y2];
            if (coordinates.some(coord => !Number.isFinite(coord))) {
                console.warn('Invalid coordinate values detected');
                return false;
            }
            const container = this.element.parentElement;
            if (!container) return false;
            const containerWidth = container.offsetWidth;
            const containerHeight = container.offsetHeight;
            const bounds = {
                minX: -containerWidth * 0.5,
                maxX: containerWidth * 1.5,
                minY: -containerHeight * 0.5,
                maxY: containerHeight * 1.5
            };
            const pointsInBounds = [
                { x: x1, y: y1 },
                { x: x2, y: y2 }
            ].every(point =>
                point.x >= bounds.minX && point.x <= bounds.maxX &&
                point.y >= bounds.minY && point.y <= bounds.maxY
            );
            if (!pointsInBounds) {
                return false;
            }
            const distance = Math.sqrt(
                Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2)
            );
            const maxDistance = Math.sqrt(
                Math.pow(containerWidth * 2, 2) +
                Math.pow(containerHeight * 2, 2)
            );
            if (distance > maxDistance) {
                console.warn('Connection distance exceeds maximum');
                return false;
            }
            return true;
        } catch (error) {
            console.error('Error validating coordinates:', error);
            return false;
        }
    }
    scheduleRetry() {
        if (!this.retryAttempts) {
            this.retryAttempts = {
                count: 3,
                delay: 100,
                maxDelay: 1000
            };
        }
        if (this.retryAttempts.count > 0) {
            setTimeout(() => {
                console.log(`Retrying connection update, attempts remaining: ${this.retryAttempts.count}`);
                this.retryAttempts.count--;
                this.updatePosition();
                this.retryAttempts.delay = Math.min(
                    this.retryAttempts.delay * 2,
                    this.retryAttempts.maxDelay
                );
            }, this.retryAttempts.delay);
            return true;
        }
        console.warn('Max retry attempts reached');
        return false;
    }
    resetRetryAttempts() {
        this.retryAttempts = {
            count: 3,
            delay: 100,
            maxDelay: 1000
        };
    }
    resetConnectionState() {
        try {
            if (this.pathElement) {
                this.pathElement.setAttribute('d', '');
            }
            if (this.sliderContainer) {
                this.sliderContainer.style.visibility = 'hidden';
            }
        } catch (error) {
            console.error('Error resetting connection state:', error);
        }
    }
    show() {
        this.isHidden = false;
        if (this.element) {
            this.element.style.display = 'block';
            this.element.style.opacity = '1';
            this.updatePosition();
        }
    }
    hide() {
        this.isHidden = true;
        if (this.element) {
            this.element.style.display = 'none';
            this.element.style.opacity = '0';
        }
    }
    scheduleRetry() {
        if (!this.retryCount) {
            this.retryCount = 3;
            this.retryDelay = 100;
        }
        if (this.retryCount > 0) {
            setTimeout(() => {
                this.retryCount--;
                this.retryDelay *= 2;
                this.updatePosition();
            }, this.retryDelay);
        } else {
            console.warn(`Failed to update connection ${this.id} after ${3 - this.retryCount} attempts`);
            this.retryCount = 3;
            this.retryDelay = 100;
        }
    }
    calculatePath(source, target) {
        try {
            const container = this.element.parentElement;
            const containerWidth = container.offsetWidth;
            const containerHeight = container.offsetHeight;
            const adjustedSource = {
                x: Math.max(0, Math.min(source.x, containerWidth)),
                y: Math.max(0, Math.min(source.y, containerHeight))
            };
            const adjustedTarget = {
                x: Math.max(0, Math.min(target.x, containerWidth)),
                y: Math.max(0, Math.min(target.y, containerHeight))
            };
            const dx = adjustedTarget.x - adjustedSource.x;
            const dy = adjustedTarget.y - adjustedSource.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const minCurvature = 0.1;
            const maxCurvature = 0.3;
            const baseCurvature = Math.min(maxCurvature, Math.max(minCurvature, 100 / distance));
            const curvature = distance < 100 ? baseCurvature * (distance / 100) : baseCurvature;
            const controlPoint1 = {
                x: adjustedSource.x + dx * curvature,
                y: adjustedSource.y + dy * curvature
            };
            const controlPoint2 = {
                x: adjustedTarget.x - dx * curvature,
                y: adjustedTarget.y - dy * curvature
            };
            return `M ${adjustedSource.x},${adjustedSource.y} ` +
                   `C ${controlPoint1.x},${controlPoint1.y} ` +
                   `  ${controlPoint2.x},${controlPoint2.y} ` +
                   `  ${adjustedTarget.x},${adjustedTarget.y}`;
        } catch (error) {
            console.error('Error calculating path:', error);
            return `M ${source.x},${source.y} L ${target.x},${target.y}`;
        }
    }
    updateGradient() {
        try {

            if (!this.element || this.isDestroyed) {
                console.log(`[Connection ${this.id}] Skip gradient update - element not ready`);
                return;
            }
            const svg = this.element.querySelector('svg');
            if (!svg) {
                console.warn(`[Connection ${this.id}] No SVG element found`);
                return;
            }
            let defs = svg.querySelector('defs');
            if (!defs) {
                defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
                svg.insertBefore(defs, svg.firstChild);
            }
            const gradientId = `gradient-${this.id}`;
            let gradient = defs.querySelector(`#${gradientId}`);
            if (!gradient) {
                gradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
                gradient.id = gradientId;
                gradient.setAttribute('gradientUnits', 'userSpaceOnUse');
                defs.appendChild(gradient);
            }
            let baseColor, darkColor;
            if (this.isMain) {
                baseColor = 'var(--primary-color)';
                darkColor = 'var(--primary-dark)';
                if (this.gradientColors && this.gradientColors.length >= 2) {
                    baseColor = this.gradientColors[0];
                    darkColor = this.gradientColors[1];
                }
            } else {
                baseColor = `var(--feature-${this.type}-base)`;
                darkColor = `var(--feature-${this.type}-dark)`;
            }
            let startStop = gradient.querySelector('.gradient-start');
            let endStop = gradient.querySelector('.gradient-end');
            if (!startStop) {
                startStop = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
                startStop.setAttribute('class', 'gradient-start');
                gradient.appendChild(startStop);
            }
            if (!endStop) {
                endStop = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
                endStop.setAttribute('class', 'gradient-end');
                gradient.appendChild(endStop);
            }
            startStop.setAttribute('offset', '0%');
            startStop.setAttribute('stop-color', darkColor);
            endStop.setAttribute('offset', '100%');
            endStop.setAttribute('stop-color', baseColor);
            if (this.pathElement) {
                this.pathElement.setAttribute('stroke', `url(#${gradientId})`);
                if (this.isMain) {
                    Object.assign(this.pathElement.style, {
                        opacity: '1',
                        strokeDasharray: 'none',
                        filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.1))'
                    });
                } else {
                    Object.assign(this.pathElement.style, {
                        opacity: this.isFolded ? '0.7' : '1',
                        strokeDasharray: this.isFolded ? '4,4' : 'none',
                        filter: 'none'
                    });
                }
            }
            console.log(`[Connection ${this.id}] Gradient updated successfully`);
        } catch (error) {
            console.error(`[Connection ${this.id}] Gradient update error:`, error);
            if (this.pathElement) {
                const fallbackColor = this.isMain ?
                    'var(--primary-color)' :
                    `var(--feature-${this.type}-base)`;
                this.pathElement.setAttribute('stroke', fallbackColor);
            }
        }
    }
    setFolded(isFolded) {
        if (this.isFolded === isFolded) return;
        this.isFolded = isFolded;
        this.element.classList.toggle('folded', isFolded);
        this.updateGradient();
        this.updatePosition();
    }
    _getConnectionPoint(node, type) {
        if (node.isAttributesFolded) {
            return node.element.querySelector('.attributes-output-point');
        }
        return node.element.querySelector(`.attribute-point[data-type="${type}"]`);
    }
    _cleanupConnection() {
        if (this._originalPoints) {
            this._originalPoints = null;
        }
        this.updatePosition();
    }
    setGradientColors(colors) {
        if (!colors || colors.length === 0) return;
        const gradient = this.element.querySelector(`#gradient-${this.id}`);
        if (!gradient) return;
        while (gradient.firstChild) {
            gradient.removeChild(gradient.firstChild);
        }
        colors.forEach((color, index) => {
            const stop = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
            stop.setAttribute('offset', `${(index / (colors.length - 1)) * 100}%`);
            stop.setAttribute('stop-color', color.trim());
            gradient.appendChild(stop);
        });
        const path = this.element.querySelector('.connection-line');
        if (path) {
            path.style.stroke = `url(#gradient-${this.id})`;
        }
    }
    getMidPoint(source, target) {
        return {
            x: (source.x + target.x) / 2,
            y: (source.y + target.y) / 2
        };
    }
    getPointPosition(point, canvasRect) {
        if (!point || !point.getBoundingClientRect) {
            return null;
        }
        try {
            const rect = point.getBoundingClientRect();
            return {
                x: rect.left + rect.width / 2 - canvasRect.left,
                y: rect.top + rect.height / 2 - canvasRect.top,
            };
        } catch (error) {
            console.error('Error getting point position:', error);
            return null;
        }
    }
    updateGradientDirection() {
        if (!this.gradientElement || !this.sourcePoint || !this.targetPoint) {
            return;
        }
        try {
            const container = this.element.parentElement;
            if (!container) return;
            const containerRect = container.getBoundingClientRect();
            const sourceRect = this.sourcePoint.getBoundingClientRect();
            const targetRect = this.targetPoint.getBoundingClientRect();
            const source = {
                x: sourceRect.left + sourceRect.width / 2 - containerRect.left,
                y: sourceRect.top + sourceRect.height / 2 - containerRect.top
            };
            const target = {
                x: targetRect.left + targetRect.width / 2 - containerRect.left,
                y: targetRect.top + targetRect.height / 2 - containerRect.top
            };
            this.gradientElement.setAttribute('x1', source.x);
            this.gradientElement.setAttribute('y1', source.y);
            this.gradientElement.setAttribute('x2', target.x);
            this.gradientElement.setAttribute('y2', target.y);
        } catch (error) {
            console.error('Error updating gradient direction:', error);
        }
    }
    extractPathPoints(path) {
        const matches = path.match(/M\s*([\d.-]+),([\d.-]+).*?([\d.-]+),([\d.-]+)\s*$/);
        if (!matches) return null;
        return {
            start: { x: parseFloat(matches[1]), y: parseFloat(matches[2]) },
            end: { x: parseFloat(matches[3]), y: parseFloat(matches[4]) }
        };
    }
    handleSliderChange(e) {
        console.log('handleSliderChange, current value:', event.target.value);
        const value = e.target.value / 100;
        this.setValue(value);
    }
    setValue(newWeight, skipBalancing = false) {
        console.log('[Connection] setValue called:', {
            id: this.id,
            newWeight,
            skipBalancing
        });
        const clamped = Math.max(0, Math.min(newWeight, 1));
        this.value = clamped;
        if (this.slider) {
            this.slider.value = (clamped * 100).toFixed(0);
        }
        if (this.valueDisplay) {
            this.valueDisplay.textContent = `${Math.round(clamped * 100)}%`;
        }
        if (this.weightIndicator) {
            this.weightIndicator.style.width = `${(clamped * 100).toFixed(1)}%`;
        }
        try {
            if (!skipBalancing && this.targetNode && this.type) {
                const connArr = this.targetNode.connectedFeatures.get(this.type);
                if (Array.isArray(connArr)) {
                    const leftover = 1 - this.value;
                    const others = connArr.filter(d => d.connection && d.connection !== this);
                    const sumOthers = others.reduce((acc, d) => acc + (d.connection.value || 0), 0);
                    if (others.length > 0) {
                        if (sumOthers > 0) {
                            others.forEach(d => {
                                const ratio = d.connection.value / sumOthers;
                                const newW = leftover * ratio;
                                d.connection.setValue(newW, true);
                            });
                        } else {
                            const avg = leftover / others.length;
                            others.forEach(d => {
                                d.connection.setValue(avg, true);
                            });
                        }
                    }
                }
            }
            this.updateVisuals?.();
            if (this.isControlVisible && this.sliderContainer) {
                this.updateControlPosition();
            }
            if (this._autoHideTimer) {
                clearTimeout(this._autoHideTimer);
            }
            this._autoHideTimer = setTimeout(() => {
                if (this.isControlVisible) {
                    this.hideControls();
                }
            }, 5000);
            this.dispatchEvent('valueChanged', {
                connection: this,
                connectionId: this.id,
                value: this.value,
                type: this.type
            });
        } catch (error) {
            console.error('[Connection] Error in setValue:', error);
            this.value = 0.5;
            this.updateVisuals?.();
        }
    }
    updateControlPosition() {
        if (!this.isControlVisible || !this.sliderContainer) return;
        const { x: sx, y: sy } = this.sourcePos || { x: 0, y: 0 };
        const { x: tx, y: ty } = this.targetPos || { x: 0, y: 0 };
        const midX = (sx + tx) / 2;
        const midY = (sy + ty) / 2;
        const container = document.querySelector('.canvas-container');
        if (!container) {
            console.warn('[updateControlPosition] .canvas-container not found');
            return;
        }
        const cRect = container.getBoundingClientRect();
        const offsetX = midX - cRect.left;
        const offsetY = midY - cRect.top;
        this.sliderContainer.style.position = 'absolute';
        this.sliderContainer.style.left = `${offsetX}px`;
        this.sliderContainer.style.top = `${offsetY}px`;
        this.sliderContainer.style.transform = 'translate(-50%, -50%)';
    }
    updateVisuals() {
        if (!this.element || this.isDestroyed) {
            console.log('Cannot update visuals: element missing or connection destroyed');
            return;
        }
        try {
            const pathElement = this.element.querySelector('.connection-line');
            if (!pathElement) {
                console.warn('Path element not found');
                return;
            }
            const baseWidth = this.isMain ? 4 : 2;
            const weightWidth = this.value * 10
            const finalWidth = baseWidth + weightWidth;
            const baseOpacity = this.isFolded ? 0.7 : 1;
            const weightOpacity = 0.3 + (this.value * 0.7);
            const finalOpacity = this.isFolded ? baseOpacity : weightOpacity;
            Object.assign(pathElement.style, {
                strokeWidth: `${finalWidth}px`,
                opacity: finalOpacity.toString(),
                strokeDasharray: this.isFolded ? '8,4' : 'none',
                transition: 'all 0.3s ease'
            });
            if (this.type !== 'main') {
                this.updateGradient();
            }

            if (this.sourcePoint) {
                Object.assign(this.sourcePoint.style, {
                    opacity: (0.5 + this.value * 0.5).toString(),
                    transition: 'all 0.3s ease'
                });
            }
            if (this.targetPoint) {
                Object.assign(this.targetPoint.style, {
                    opacity: (0.5 + this.value * 0.5).toString(),
                    transition: 'all 0.3s ease'
                });
            }
            if (this.weightIndicator) {
                const width = Math.max(30, Math.min(100, this.value * 100));
                Object.assign(this.weightIndicator.style, {
                    width: `${width}px`,
                    opacity: this.value.toString(),
                    transition: 'all 0.3s ease'
                });
            }
            const hitArea = this.element.querySelector('.connection-hit-area');
            if (hitArea) {
                hitArea.style.strokeWidth = `${Math.max(20, finalWidth + 10)}px`;
            }
            if (this.isMain) {
                Object.assign(pathElement.style, {
                    filter: `drop-shadow(0 0 ${2 + this.value * 2}px rgba(0,0,0,0.1))`,
                    strokeDasharray: 'none'
                });
            }
            if (this.isFolded) {
                Object.assign(pathElement.style, {
                    strokeDasharray: '8,4',
                    //strokeWidth: '2px',
                    opacity: '0.8'
                });
            }
            if (this.element.classList.contains('using-main-point')) {
                Object.assign(pathElement.style, {
                    strokeDasharray: '4,4',
                    //strokeWidth: '2px',
                    opacity: '0.8'
                });
            }
            console.log('Visuals updated successfully:', {
                connectionId: this.id,
                width: finalWidth,
                opacity: finalOpacity,
                isFolded: this.isFolded,
                isMain: this.isMain,
                value: this.value
            });
        } catch (error) {
            console.error('Error updating connection visuals:', {
                error,
                connectionId: this.id,
                elementExists: !!this.element,
                isDestroyed: this.isDestroyed
            });
        }
    }
    updateConnectionStyle() {
        const gradientStart = document.querySelector(`#gradient-${this.id} .gradient-start`);
        const gradientEnd = document.querySelector(`#gradient-${this.id} .gradient-end`);
        const baseColor = `var(--feature-${this.type}-base)`;
        const darkColor = `var(--feature-${this.type}-dark)`;
        gradientStart.style.stopColor = darkColor;
        gradientEnd.style.stopColor = baseColor;
        if (this.isFolded) {
            this.pathElement.style.strokeDasharray = '8 4';
        } else {
            this.pathElement.style.strokeDasharray = 'none';
        }
    }
    updateWeightIndicator(isHovered = false) {
        if (!this.weightIndicator) return;
        const width = Math.max(30, Math.min(100, this.value * 100));
        this.weightIndicator.style.width = `${width}px`;
        if (isHovered) {
            this.weightIndicator.dataset.value = `${Math.round(this.value * 100)}%`;
        } else {
            delete this.weightIndicator.dataset.value;
        }
    }
    toggleControls() {
        if (this.isControlVisible) {
            this.hideControls();
        } else {
            this.showControls();
        }
    }
    showControls() {
        console.log('[Connection] showControls:', this.id);
        document.querySelectorAll('.connection').forEach(connEl => {
            if (connEl.__instance__ && connEl.__instance__ !== this) {
                connEl.__instance__.hideControls();
            }
        });
        this.isControlVisible = true;
        if (this.sliderContainer) {
            this.sliderContainer.style.display = 'flex'; // or 'block'
            this.sliderContainer.style.opacity = '1';
            this.updateControlPosition();
        }
        this.element.classList.add('controls-visible');
    }
    hideControls() {
        if (!this.isControlVisible) return;
        this.isControlVisible = false;
        this.element.classList.remove('controls-visible');
        this.sliderContainer.style.opacity = '0';
        setTimeout(() => {
            if (!this.isControlVisible) {
                this.sliderContainer.style.display = 'none';
            }
        }, 300);
    }
    handleDocumentClick(e) {
        if (this.isControlVisible &&
            !this.element.contains(e.target) &&
            !this.sliderContainer.contains(e.target)) {
            this.hideControls();
        }
    }
    dispatchEvent(eventName, detail = {}) {
        try {
            if (this.isDestroyed) {
                console.warn(`Attempted to dispatch event '${eventName}' on destroyed connection`);
                return;
            }
            if (!this.element) {
                console.warn(`Cannot dispatch event '${eventName}': element is null`);
                return;
            }
            if (!eventName) {
                console.warn('Event name is required');
                return;
            }
            const eventDetail = {
                ...detail,
                connection: this,
                type: this.type,
                sourceNodeId: this.sourceNode?.id,
                targetNodeId: this.targetNode?.id,
                timestamp: Date.now()
            };
            const event = new CustomEvent(eventName, {
                bubbles: true,
                cancelable: true,
                detail: eventDetail
            });
            console.log(`Dispatching ${eventName}:`, eventDetail);
            const dispatched = this.element.dispatchEvent(event);
            if (!dispatched) {
                console.log(`Event '${eventName}' was cancelled`);
            }
            return dispatched;
        } catch (error) {
            console.error(`Error dispatching event '${eventName}':`, error);
            return false;
        }
    }
    destroy() {
        try {
            if (this.isDestroyed) {
                console.log('Connection already destroyed');
                return;
            }
            this.isDestroyed = true;
            console.log('Destroying connection:', this.id);
            if (this._animationFrame) {
                cancelAnimationFrame(this._animationFrame);
                this._animationFrame = null;
            }
            this.cleanup();
            if (this.element) {
                this.dispatchEvent('connectionDestroyed', {
                    connection: this,
                    type: this.type,
                    sourceNodeId: this.sourceNode?.id,
                    targetNodeId: this.targetNode?.id
                });
            }
            if (this.sourcePoint) {
                this.sourcePoint.classList.remove('connected');
                this.sourcePoint.style.pointerEvents = 'auto';
            }
            if (this.targetPoint) {
                this.targetPoint.classList.remove('connected');
                this.targetPoint.style.pointerEvents = 'auto';
            }
            if (this.element && this.element.parentNode) {
                Object.assign(this.element.style, {
                    transition: 'all 0.3s ease',
                    opacity: '0',
                    transform: 'scale(0.95)'
                });
                setTimeout(() => {
                    if (this.element?.parentNode) {
                        try {
                            this.element.parentNode.removeChild(this.element);
                        } catch (removeError) {
                            console.error('Error removing element:', removeError);
                        }
                    }
                }, 300);
            }
            this.svgElement = null;
            this.pathElement = null;
            this.hitArea = null;
            this.sliderContainer = null;
            this.slider = null;
            this.valueDisplay = null;
            this.weightIndicator = null;
            this.gradientElement = null;
            this.element = null;
            this.sourceNode = null;
            this.targetNode = null;
            this.sourcePoint = null;
            this.targetPoint = null;
            this._lastValidPath = null;
            this._boundHandlers = {};
            this._positionCache = null;
            console.log('Connection destroyed successfully:', this.id);
        } catch (error) {
            console.error('Error during connection destruction:', error);
            try {
                if (this.element?.parentNode) {
                    this.element.parentNode.removeChild(this.element);
                }
            } catch (e) {
                console.error('Emergency cleanup failed:', e);
            }
            this.element = null;
            this.sourceNode = null;
            this.targetNode = null;
        }
    }
getState() {
    return {
        sourceId: this.sourceNode.id,
        targetId: this.targetNode.id,
        type: this.type,
        value: this.value,
        isExpanded: this.isExpanded,
        isFolded: this.isFolded
    };
}
setState(state) {
    this.value = state.value;
    this.isExpanded = state.isExpanded;
    this.isFolded = state.isFolded;
    this.updateVisuals();
}
animateConnection(duration = 300) {
    this.element.style.transition = `all ${duration}ms ease`;
    this.updatePosition();
}
cleanup() {
    try {
        if (!this._boundHandlers && !this.element) {
            return;
        }
        console.log('Starting cleanup for connection:', this.id);
        window.removeEventListener('resize', this.boundUpdatePosition);
        if (this.sourceNode?.element) {
            this.sourceNode.element.removeEventListener('nodeMoved', this.boundUpdatePosition);
            this.sourceNode.element.removeEventListener('nodeDestroyed', this.boundHandleNodeDestroyed);
        }
        if (this.targetNode?.element) {
            this.targetNode.element.removeEventListener('nodeMoved', this.boundUpdatePosition);
            this.targetNode.element.removeEventListener('nodeDestroyed', this.boundHandleNodeDestroyed);
        }
        if (this.sourcePoint) {
            this.sourcePoint.removeEventListener('mouseenter', this._boundHandlers.handleSourcePointMouseEnter);
            this.sourcePoint.removeEventListener('mouseleave', this._boundHandlers.handleSourcePointMouseLeave);
            this.sourcePoint.classList.remove('connected');
        }
        if (this.targetPoint) {
            this.targetPoint.removeEventListener('mouseenter', this._boundHandlers.handleTargetPointMouseEnter);
            this.targetPoint.removeEventListener('mouseleave', this._boundHandlers.handleTargetPointMouseLeave);
            this.targetPoint.classList.remove('connected');
        }
        if (this.element) {
            this.element.removeEventListener('mouseenter', this._boundHandlers.handleMouseEnter);
            this.element.removeEventListener('mouseleave', this._boundHandlers.handleMouseLeave);
            this.element.removeEventListener('click', this._boundHandlers.handleClick);
            this.element.removeEventListener('dblclick', this._boundHandlers.handleDoubleClick);
            if (this.slider) {
                this.slider.removeEventListener('input', this._boundHandlers.handleSliderInput);
                this.slider.removeEventListener('change', this._boundHandlers.handleSliderChange);
            }
            document.removeEventListener('click', this._boundHandlers.handleDocumentClick);
            document.removeEventListener('mousemove', this._boundHandlers.handleMouseMove);
            document.removeEventListener('mouseup', this._boundHandlers.handleMouseUp);
        }
        if (this._animationFrame) {
            cancelAnimationFrame(this._animationFrame);
            this._animationFrame = null;
        }
        if (this._timeouts) {
            this._timeouts.forEach(timeout => clearTimeout(timeout));
            this._timeouts.clear();
        }
        this._boundHandlers = {};
        this.boundUpdatePosition = null;
        this.boundHandleDocumentClick = null;
        this.boundHandleSliderChange = null;
        this.boundHandleNodeDestroyed = null;
        console.log('Cleanup completed for connection:', this.id);
    } catch (error) {
        console.error('Error during connection cleanup:', error);
        this._boundHandlers = {};
        this._timeouts = new Set();
        this._animationFrame = null;
    }
}
    getValue() {
        return this.value;
    }
}
export default Connection;