import apiService from './api.js';
import Connection from './connection.js';
class Node {
    constructor(id, imageUrl = null, prompt = null) {
        this.id = id || Date.now().toString();
        this.imageUrl = imageUrl;
        this.prompt = prompt;
        this.position = { x: 0, y: 0 };
        this.isEmptyFrame = !imageUrl && !prompt;
        this.isAnalyzing = false;
        this.isAttributesExpanded = true;
        this.selected = false;
        this.isAttributesFolded = false;
        this.isDragging = false;
        this.isProcessing = false;
        this.isDestroyed = false;
        this.isGenerationEnabled = false;
        this.featureAnalysis = null;
        this.connectedFeatures = new Map();
        this.inheritedFeatures = new Map();
        this.promptHistory = [];
        this._mainConnection = null;
        this._positionCache = null;
        this.isProcessingFold = false;
        this._transitioningConnections = new Set();
        this._hiddenAttributes = new Set();
        this._intersectionObserver = null;
        this.foldedGroups = new Set();
        this.mainConnectionExists = false;
        this.handleConnectionCreated = this.handleConnectionCreated.bind(this);
        document.addEventListener('connectionCreated', this.handleConnectionCreated);
        this.handleConnectionDestroyed = this.handleConnectionDestroyed.bind(this);
        this.handleGroupToggle = this.handleGroupToggle.bind(this);
        document.addEventListener('connectionCreated', this.handleConnectionCreated.bind(this));
        document.addEventListener('connectionDestroyed', this.handleConnectionDestroyed);
        try {
            this.element = this.createElement();
            if (!this.element) {
                throw new Error('Failed to create node element');
            }
            this.setupEventListeners();
            this.setupDragging();
            this.setupCollapsibleSections();
            this.setupAttributePoints();
            this.mainConnections = new Map();
            if (this.imageUrl || this.prompt) {
                this.analyzeFeatures().catch(error => {
                    console.error('Initial analysis failed:', error);
                    this.setAnalysisStatus('Analysis failed', true);
                });
            }
        } catch (error) {
            console.error('Node initialization failed:', error);
            console.error('Error setting up scroll observer:', error);
            throw error;
        }
    }
    /**
     *
     * @param {Object} options
     * @param {string} [options.type]
     * @param {Connection} [options.connection]
     * @param {HTMLElement} [options.point]
     */
    _switchConnectionToMainOutput({ type, connection, point }) {
        try {
            if (!this.element || !type || !connection) return;
            const mainOutputPoint = this.element.querySelector('.attributes-output-point');
            if (!mainOutputPoint) return;

            if (!connection._originalSourcePoint) {
                connection._originalSourcePoint = connection.sourcePoint;
            }

            connection.sourcePoint = mainOutputPoint;
            connection.element.classList.add('using-main-point');

            if (connection.pathElement) {
                Object.assign(connection.pathElement.style, {
                    //strokeDasharray: '4,4',
                    //strokeWidth: '2px',
                    opacity: '0.8',
                    transition: 'all 0.3s ease'
                });
            }

            const attributePoint = point || connection._originalSourcePoint;
            if (attributePoint) {
                Object.assign(attributePoint.style, {
                    opacity: '0',
                    visibility: 'hidden',
                    pointerEvents: 'none',
                    transition: 'all 0.3s ease'
                });
            }

            requestAnimationFrame(() => {
                if (!connection.isDestroyed) {
                    connection.updatePosition();
                }
            });
        } catch (error) {
            console.error('Error switching to main output:', error);
        }
    }
    handleNodeMoved(event) {
        try {
            const { node, position } = event.detail;
            if (!node || node.isDestroyed) return;
            console.log('[handleNodeMoved]', {
                nodeId: node.id,
                position,
                isFolded: node.isAttributesFolded
            });
            //
            //
            this.connections.forEach(connection => {
                //
                if (connection.sourceNode === node || connection.targetNode === node) {
                    //
                    if (node.isAttributesFolded && connection.sourceNode === node) {
                        //
                        if (!connection.element.classList.contains('using-main-point')) {
                            console.log('[handleNodeMoved] Switch to mainOutput for folded node:', connection.id);
                            node._switchConnectionToMainOutput({
                                type: connection.type,
                                connection
                            });
                        }
                    }
                    //
                    //
                    //
                    requestAnimationFrame(() => {
                        if (!connection.isDestroyed) {
                            connection.updatePosition();
                        }
                    });
                }
            });
        } catch (error) {
            console.error('[handleNodeMoved] error:', error);
        }
    }
    getGroupConnections(groupName) {
        try {
            //
            const group = this.element.querySelector(`.attribute-group[data-group="${groupName}"]`);
            if (!group) {
                console.warn(`Group ${groupName} not found`);
                return [];
            }
            //
            const groupTypes = Array.from(
                group.querySelectorAll('.attribute-point[data-type]')
            ).map(point => point.dataset.type);
            console.log('Group types found:', {
                groupName,
                types: groupTypes
            });
            //
            const groupConnections = [];
            for (const type of groupTypes) {
                //
                const typeConnections = this.connectedFeatures.get(type) || [];
                //
                const connections = Array.isArray(typeConnections) ? typeConnections : [typeConnections];
                connections.forEach(conn => {
                    if (conn && conn.connection) {
                        groupConnections.push({
                            ...conn,
                            group: groupName,
                            type
                        });
                    }
                });
            }
            console.log('Collected group connections:', {
                groupName,
                count: groupConnections.length,
                connections: groupConnections.map(conn => ({
                    id: conn.connection?.id,
                    type: conn.type,
                    sourceNodeId: conn.sourceNode?.id,
                    targetNodeId: conn.targetNode?.id
                }))
            });
            return groupConnections;
        } catch (error) {
            console.error('Error getting group connections:', {
                groupName,
                error: error.message,
                stack: error.stack
            });
            return [];
        }
    }
    handleGroupToggle(groupName) {
        if (this.isProcessingFold) return;
        this.isProcessingFold = true;
        try {
            console.log(`[Node ${this.id}] Toggling group:`, groupName);

            const group = this.element.querySelector(`.attribute-group[data-group="${groupName}"]`);
            const mainOutputPoint = this.element.querySelector('.attributes-output-point');
            const content = group?.querySelector('.group-content');
            if (!group || !mainOutputPoint || !content) {
                console.warn('Required elements not found for group toggle');
                return;
            }

            const willBeFolded = !this.foldedGroups.has(groupName);
            console.log('Group fold state:', { willBeFolded, groupName });

            const groupConnections = this.getGroupConnections(groupName);
            console.log('Group connections:', groupConnections);

            const relevantConnections = groupConnections.filter(data =>
                data.connection &&
                data.sourceNode &&
                data.sourceNode.id === this.id
            );
            console.log('Processing relevant connections:', {
                total: groupConnections.length,
                relevant: relevantConnections.length,
                nodeId: this.id
            });
            if (willBeFolded) {

                this.foldedGroups.add(groupName);

                group.classList.add('collapsed');
                const startHeight = content.scrollHeight;
                content.style.height = startHeight + 'px';
                content.offsetHeight;
                Object.assign(content.style, {
                    height: '0',
                    opacity: '0',
                    overflow: 'hidden',
                    transition: 'all 0.3s ease'
                });

                mainOutputPoint.classList.add('active');
                Object.assign(mainOutputPoint.style, {
                    opacity: '1',
                    visibility: 'visible',
                    pointerEvents: 'auto',
                    transition: 'all 0.3s ease'
                });

                const processedConnections = new Set();
                relevantConnections.forEach(data => {
                    try {
                        const connection = data.connection;

                        if (!connection._originalSourcePoint) {
                            connection._originalSourcePoint = connection.sourcePoint;
                        }

                        const attributePoint = connection._originalSourcePoint;
                        if (attributePoint) {
                            Object.assign(attributePoint.style, {
                                opacity: '0',
                                visibility: 'hidden',
                                pointerEvents: 'none',
                                transition: 'all 0.3s ease'
                            });
                        }

                        connection.sourcePoint = mainOutputPoint;
                        connection.element.classList.add('using-main-point');

                        if (connection.pathElement) {
                            Object.assign(connection.pathElement.style, {
                                strokeDasharray: '4,4',
                                // strokeWidth: '2px',
                                opacity: '0.8',
                                transition: 'all 0.3s ease'
                            });
                        }
                        processedConnections.add(connection.id);
                    } catch (connError) {
                        console.error('Error processing connection:', {
                            connectionId: data.connection?.id,
                            error: connError
                        });
                    }
                });

                if (processedConnections.size > 0) {
                    requestAnimationFrame(() => {
                        relevantConnections.forEach(data => {
                            if (!data.connection.isDestroyed && processedConnections.has(data.connection.id)) {
                                data.connection.updatePosition();
                            }
                        });
                    });
                }
            } else {

                this.foldedGroups.delete(groupName);

                group.classList.remove('collapsed');
                content.style.height = 'auto';
                const targetHeight = content.scrollHeight;
                content.style.height = '0';
                content.offsetHeight;
                Object.assign(content.style, {
                    height: `${targetHeight}px`,
                    opacity: '1',
                    overflow: 'hidden',
                    transition: 'all 0.3s ease'
                });

                setTimeout(() => {
                    if (!this.isDestroyed && !this.foldedGroups.has(groupName)) {
                        content.style.height = 'auto';
                        content.style.overflow = 'visible';
                    }
                }, 300);

                const processedConnections = new Set();
                relevantConnections.forEach(data => {
                    try {
                        const connection = data.connection;
                        if (connection._originalSourcePoint) {

                            connection.sourcePoint = connection._originalSourcePoint;
                            connection.element.classList.remove('using-main-point');

                            Object.assign(connection._originalSourcePoint.style, {
                                opacity: '1',
                                visibility: 'visible',
                                pointerEvents: 'auto',
                                transition: 'all 0.3s ease'
                            });

                            if (connection.pathElement) {
                                Object.assign(connection.pathElement.style, {
                                    strokeDasharray: 'none',
                                    // strokeWidth: '2px',
                                    opacity: '1',
                                    transition: 'all 0.3s ease'
                                });
                            }
                            delete connection._originalSourcePoint;
                            processedConnections.add(connection.id);
                        }
                    } catch (connError) {
                        console.error('Error restoring connection:', {
                            connectionId: data.connection?.id,
                            error: connError
                        });
                    }
                });

                if (this.foldedGroups.size === 0 && !this.isAttributesFolded) {
                    mainOutputPoint.classList.remove('active');
                    Object.assign(mainOutputPoint.style, {
                        opacity: '0',
                        visibility: 'hidden',
                        pointerEvents: 'none',
                        transition: 'all 0.3s ease'
                    });
                }

                if (processedConnections.size > 0) {
                    requestAnimationFrame(() => {
                        relevantConnections.forEach(data => {
                            if (!data.connection.isDestroyed && processedConnections.has(data.connection.id)) {
                                data.connection.updatePosition();
                            }
                        });
                    });
                }
            }

            this.dispatchEvent('groupFoldChanged', {
                groupName,
                isFolded: willBeFolded,
                nodeId: this.id
            });
        } catch (error) {
            console.error('Error in handleGroupToggle:', error);
        } finally {
            setTimeout(() => {
                this.isProcessingFold = false;
            }, 350);
        }
    }
    _getActiveGroupConnections(groupName) {
        const connections = new Set();
        try {
            const group = this.element.querySelector(`.attribute-group[data-group="${groupName}"]`);
            if (!group) return connections;

            const attributePoints = Array.from(group.querySelectorAll('.attribute-point'));
            if (!attributePoints.length) return connections;

            this.connectedFeatures.forEach((data, type) => {
                const attributePoint = attributePoints.find(point => point.dataset.type === type);
                if (!attributePoint) return;
                const connection = data.connection;
                if (!connection || connection.isDestroyed) return;
                if (connection.sourceNode === this || connection.targetNode === this) {
                    connections.add(connection);
                }
            });
            return connections;
        } catch (error) {
            console.error('Error in _getActiveGroupConnections:', error);
            return new Set();
        }
    }
    _hasAnyFoldedGroups() {
        return this.foldedGroups.size > 0;
    }
    _hasAnyFoldedConnections() {

        if (this.isAttributesFolded) {
            return true;
        }

        if (this.foldedGroups && this.foldedGroups.size > 0) {
            return true;
        }
        return false;
    }
    _removeMainConnection() {
        try {
            console.log('Removing main connection');

            const mainConnection = Array.from(this.connectedFeatures.values())
                .find(data => data.connection?.isMain)?.connection;
            if (!mainConnection) {
                console.log('No main connection found');
                return;
            }

            const mainOutputPoint = this.element.querySelector('.attributes-output-point');

            if (mainConnection.element) {
                mainConnection.element.style.transition = 'opacity 0.3s ease';
                mainConnection.element.style.opacity = '0';
            }

            if (mainOutputPoint) {
                mainOutputPoint.classList.remove('active');
                Object.assign(mainOutputPoint.style, {
                    transition: 'all 0.3s ease',
                    opacity: '0',
                    visibility: 'hidden'
                });
            }

            setTimeout(() => {
                mainConnection.destroy();

                const mainEntry = Array.from(this.connectedFeatures.entries())
                    .find(([_, data]) => data.connection?.isMain);
                if (mainEntry) {
                    this.connectedFeatures.delete(mainEntry[0]);
                }
                console.log('Main connection removed successfully');
            }, 300);
        } catch (error) {
            console.error('Error removing main connection:', error);
        }
    }
    _createMainConnection() {
        try {
            console.log(`[Node ${this.id}] Creating main connection`);

            const existingMain = Array.from(this.connectedFeatures.values())
                .find(data => data.connection?.isMain)?.connection;
            if (existingMain && !existingMain.isDestroyed) {
                console.log('Using existing main connection:', existingMain.id);
                return existingMain;
            }

            const mainOutputPoint = this.element.querySelector('.attributes-output-point');
            if (!mainOutputPoint) {
                console.error('Main output point not found');
                return null;
            }

            const container = document.querySelector('.canvas-container');
            if (!container) {
                console.error('Canvas container not found');
                return null;
            }

            const mainConnection = new Connection(
                this,
                null,
                'main',
                mainOutputPoint,
                null
            );
            if (!mainConnection || !mainConnection.element) {
                console.error('Failed to create main connection element');
                return null;
            }

            mainConnection.isMain = true;
            mainConnection.value = 1;

            Object.assign(mainConnection.element.style, {
                position: 'absolute',
                top: '0',
                left: '0',
                width: '100%',
                height: '100%',
                opacity: '1',
                zIndex: '100',
                pointerEvents: 'none',
                transition: 'all 0.3s ease'
            });

            if (mainConnection.pathElement) {
                Object.assign(mainConnection.pathElement.style, {
                    // strokeWidth: '4px',
                    opacity: '1',
                    strokeDasharray: 'none',
                    filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.1))',
                    transition: 'all 0.3s ease'
                });
            }

            mainOutputPoint.classList.add('active');
            Object.assign(mainOutputPoint.style, {
                opacity: '1',
                visibility: 'visible',
                pointerEvents: 'auto',
                transition: 'all 0.3s ease'
            });

            const colors = this.getActiveConnectionColors();
            if (colors.length > 0) {
                mainConnection.setGradientColors(colors);
            }

            container.appendChild(mainConnection.element);

            requestAnimationFrame(() => {
                if (!mainConnection.isDestroyed) {
                    mainConnection.updatePosition();
                }
            });

            if (!this.mainConnections) {
                this.mainConnections = new Map();
            }
            this.mainConnections.set(mainConnection.id, mainConnection);
            console.log(`Main connection created successfully: ${mainConnection.id}`);
            return mainConnection;
        } catch (error) {
            console.error('Error creating main connection:', error);
            return null;
        }
    }
    _createGroupMainConnection(mainOutputPoint, originalConnections) {
        if (!originalConnections?.length) return null;
        try {

            const firstConnection = originalConnections[0];
            const targetNode = firstConnection.targetNode;
            const targetPoint = firstConnection.targetPoint;

            const mainConnection = new Connection(
                this,               // source node
                targetNode,         // target node
                'main',            // type
                mainOutputPoint,    // source point
                targetPoint        // target point
            );
            if (!mainConnection?.element) {
                throw new Error('Failed to create main connection element');
            }

            mainConnection.isMain = true;

            Object.assign(mainConnection.element.style, {
                position: 'absolute',
                top: '0',
                left: '0',
                width: '100%',
                height: '100%',
                opacity: '1',
                zIndex: '101',
                pointerEvents: 'none',
                transition: 'all 0.3s ease'
            });

            if (mainConnection.pathElement) {
                Object.assign(mainConnection.pathElement.style, {
                    strokeDasharray: '4,4',
                    //strokeWidth: '3px',
                    opacity: '1',
                    transition: 'all 0.3s ease'
                });
            }
            const colors = originalConnections.map(conn => `var(--feature-${conn.type}-base)`);
            if (colors.length === 1) {
                colors.push(colors[0]);
            }
            mainConnection.setGradientColors(colors);
            const container = document.querySelector('.canvas-container');
            if (container) {
                container.appendChild(mainConnection.element);
            }
            requestAnimationFrame(() => {
                if (!mainConnection.isDestroyed) {
                    mainConnection.updatePosition();
                }
            });
            return mainConnection;
        } catch (error) {
            console.error('Error creating group main connection:', error);
            return null;
        }
    }
    getActiveConnectionColors() {
        try {
            const colors = new Set();
            this.connectedFeatures.forEach((data, type) => {
                if (data.connection && !data.connection.isDestroyed) {
                    colors.add(`var(--feature-${type}-base)`);
                    colors.add(`var(--feature-${type}-dark)`);
                }
            });
            if (colors.size === 0) {
                return [
                    'var(--primary-color)',
                    'var(--primary-dark)'
                ];
            }
            const colorArray = Array.from(colors);
            if (colorArray.length === 1) {
                colorArray.push(colorArray[0]);
            }
            return colorArray.sort();
        } catch (error) {
            console.error('Error getting active connection colors:', error);
            return [
                'var(--primary-color)',
                'var(--primary-dark)'
            ];
        }
    }
    /**
 *
 * @param {string} type
 */
    updateFeatureWeights(type) {
        try {
            const connectionsArray = this.connectedFeatures.get(type);
            if (!connectionsArray || connectionsArray.length === 0) {
                console.log(`No connections found for type: ${type}`);
                return;
            }
            const featureElements = this.element.querySelectorAll(
                `.attribute-item[data-type="${type}"] .feature-tag`
            );
            if (!featureElements.length) {
                console.log(`No feature elements found for type: ${type}`);
                return;
            }
            let enabledCount = 0;
            let totalCount = 0;
            let enabledScoreSum = 0;
            let totalScoreSum = 0;
            featureElements.forEach(el => {
                totalCount++;
                const score = parseFloat(el.dataset.score) || 0;
                totalScoreSum += score;
                if (el.dataset.enabled === 'true') {
                    enabledCount++;
                    enabledScoreSum += score;
                }
            });
            connectionsArray.forEach(data => {
                const connection = data.connection;
                if (!connection) return;
                let newWeight = data.weight;
                if (totalCount > 0 && totalScoreSum > 0) {
                    newWeight *= (enabledScoreSum / totalScoreSum);
                } else if (totalCount > 0) {
                    newWeight *= (enabledCount / totalCount);
                }
                newWeight = Math.max(0, Math.min(1, newWeight));
                data.weight = newWeight;

                connection.setValue(newWeight, true);
                // this.updateConnectionVisuals(type, newWeight, connection);
            });

            this.dispatchEvent('featureWeightsUpdated', { type });
            this.updateGenerationStatus();
        } catch (error) {
            console.error('Error updating feature weights:', error);
        }
    }
    /**
 *
 * @param {string} type
 * @param {number} weight
 */
    updateConnectionVisuals(type, weight) {
        try {
            const connectionsArray = this.connectedFeatures.get(type);
            if (!connectionsArray || connectionsArray.length === 0) {
                console.log(`[updateConnectionVisuals] No connections found for type: ${type}`);
                return;
            }
            connectionsArray.forEach(data => {
                const connection = data.connection;
                if (!connection || connection.isDestroyed) return;
                if (connection.pathElement) {
                    Object.assign(connection.pathElement.style, {
                        opacity: (0.3 + weight * 0.7).toString(),
                        // strokeWidth: `${2 + (weight * 200)}px`,
                        transition: 'all 0.3s ease'
                    });
                }
                if (connection.isMain && connection.pathElement) {
                    Object.assign(connection.pathElement.style, {
                        // strokeWidth: '4px',
                        opacity: (weight > 0) ? '1' : '0.5',
                        filter: (weight > 0)
                            ? 'drop-shadow(0 0 2px rgba(0,0,0,0.1))'
                            : 'none'
                    });
                }
                const weightIndicator = connection.element.querySelector('.connection-weight-indicator');
                if (weightIndicator) {
                    weightIndicator.style.width = `${(weight * 100).toFixed(1)}%`;
                    weightIndicator.style.opacity = (weight > 0) ? '1' : '0.5';
                }
                if (connection.sourcePoint) {
                    connection.sourcePoint.style.opacity = (weight > 0) ? '1' : '0.5';
                }
                if (connection.targetPoint) {
                    connection.targetPoint.style.opacity = (weight > 0) ? '1' : '0.5';
                }
                const valueDisplay = connection.element.querySelector('.connection-value');
                if (valueDisplay) {
                    valueDisplay.textContent = `${Math.round(weight * 100)}%`;
                    valueDisplay.style.opacity = (weight > 0) ? '1' : '0.5';
                }
                connection.element.style.pointerEvents = (weight > 0) ? 'auto' : 'none';
                console.log('[updateConnectionVisuals] Updated one connection:', {
                    type,
                    weight,
                    connectionId: connection.id
                });
            });
        } catch (error) {
            console.error('Error updating connection visuals:', error);
        }
    }
    updateFeatureWeights() {
        this.connectedFeatures.forEach((data, type) => {
            if (data.connection) {
                const enabledFeatures = Object.entries(data.features || {})
                    .filter(([feature]) => !this.disabledFeatures.has(`${type}:${feature}`))
                    .length;
                if (enabledFeatures === 0) {
                    data.connection.setValue(0);
                } else {
                    const newWeight = data.weight * (enabledFeatures / Object.keys(data.features || {}).length);
                    data.connection.setValue(newWeight);
                }
            }
        });
    }
    _restoreGroupConnections(groupName, connections) {
        if (this.isAttributesFolded) return;
        try {
            console.log(`[Node ${this.id}] _restoreGroupConnections:`, {
                groupName,
                connectionCount: connections.size
            });
            const connectionsToRestore = Array.from(connections).filter(conn =>
                conn && !conn.isDestroyed && conn.element?.classList.contains('using-main-point')
            );
            if (connectionsToRestore.length === 0) {
                console.log('No connections need restoration');
                return;
            }
            connectionsToRestore.forEach(connection => {
                try {
                    if (connection._originalSourcePoint) {
                        connection.sourcePoint = connection._originalSourcePoint;
                        delete connection._originalSourcePoint;
                        connection.element.classList.remove('using-main-point');
                        if (connection.pathElement) {
                            Object.assign(connection.pathElement.style, {
                                strokeDasharray: 'none',
                                // strokeWidth: '2px',
                                opacity: '1',
                                transition: 'all 0.3s ease'
                            });
                        }
                        const point = connection.sourcePoint;
                        if (point) {
                            Object.assign(point.style, {
                                opacity: '1',
                                visibility: 'visible',
                                pointerEvents: 'auto',
                                transition: 'all 0.3s ease'
                            });
                        }
                    }
                } catch (connError) {
                    console.error('Error restoring connection:', {
                        connectionId: connection.id,
                        error: connError
                    });
                }
            });
            requestAnimationFrame(() => {
                connectionsToRestore.forEach(conn => {
                    if (!conn.isDestroyed) {
                        conn.updatePosition();
                    }
                });
            });
            const mainOutputPoint = this.element.querySelector('.attributes-output-point');
            if (mainOutputPoint && !this._hasAnyFoldedGroups()) {
                mainOutputPoint.classList.remove('active');
                Object.assign(mainOutputPoint.style, {
                    opacity: '0',
                    visibility: 'hidden',
                    pointerEvents: 'none',
                    transition: 'all 0.3s ease'
                });
            }
            const group = this.element.querySelector(`.attribute-group[data-group="${groupName}"]`);
            if (group) {
                group.classList.remove('folded');
                const content = group.querySelector('.group-content');
                if (content) {
                    content.style.height = 'auto';
                    content.style.opacity = '1';
                    content.style.overflow = 'visible';
                }
            }
            console.log('Group connections restored:', {
                groupName,
                restoredCount: connectionsToRestore.length
            });
        } catch (error) {
            console.error('Error in _restoreGroupConnections:', {
                groupName,
                error,
                nodeId: this.id
            });
            this._recoverFromFoldError(groupName);
        }
    }
    handleGroupFoldChanged(event) {
        try {
            const { groupName, isFolded } = event.detail;
            if (isFolded) {
                this.foldedGroups.add(groupName);
            } else {
                this.foldedGroups.delete(groupName);
            }
            const connections = this._getGroupConnections(groupName);
            const hasMainConnection = this._checkMainConnectionExists();
            if (isFolded) {
                if (hasMainConnection) {
                    this._hideAttributeConnections(connections);
                } else {
                    this._createGroupMainConnection(groupName, connections);
                }
            } else if (!this.isAttributesFolded) {
                this._restoreGroupConnections(groupName, connections);
            }
            requestAnimationFrame(() => {
                this.updateConnectionsVisibility();
            });
        } catch (error) {
            console.error('Error in handleGroupFoldChanged:', error);
        }
    }
    _hideAttributeConnections(connections) {
        try {
            connections.forEach(connection => {
                const attributePoint = connection.sourcePoint;
                if (attributePoint && attributePoint.classList.contains('attribute-point')) {
                    attributePoint.style.opacity = '0';
                    attributePoint.style.visibility = 'hidden';
                    attributePoint.style.pointerEvents = 'none';
                }
                connection.element.style.opacity = '0';
                connection.element.style.pointerEvents = 'none';
                Object.assign(connection.element.style, {
                    transition: 'all 0.3s ease',
                    opacity: '0'
                });
            });
        } catch (error) {
            console.error('Error in _hideAttributeConnections:', error);
        }
    }
    _createGroupMainConnection(groupName, connections) {
        try {
            const mainOutputPoint = this.element.querySelector('.attributes-output-point');
            if (!mainOutputPoint) {
                console.warn('Main output point not found');
                return;
            }
            mainOutputPoint.classList.add('active');
            mainOutputPoint.style.opacity = '1';
            mainOutputPoint.style.visibility = 'visible';
            mainOutputPoint.style.pointerEvents = 'auto';
            connections.forEach(connection => {
                if (!connection._originalSourcePoint) {
                    connection._originalSourcePoint = connection.sourcePoint;
                }
                connection.sourcePoint = mainOutputPoint;
                connection.element.classList.add('using-main-point');
                const pathElement = connection.element.querySelector('.connection-line');
                if (pathElement) {
                    Object.assign(pathElement.style, {
                        strokeDasharray: '4,4',
                        // strokeWidth: '2px',
                        opacity: '0.8',
                        transition: 'all 0.3s ease'
                    });
                }
                const attributePoint = this._originalSourcePoint;
                if (attributePoint) {
                    attributePoint.style.opacity = '0';
                    attributePoint.style.visibility = 'hidden';
                    attributePoint.style.pointerEvents = 'none';
                }
            });
            requestAnimationFrame(() => {
                connections.forEach(connection => {
                    connection.updatePosition();
                });
            });
        } catch (error) {
            console.error('Error in _createGroupMainConnection:', error);
        }
    }
    _checkMainConnectionExists() {
        try {
            const mainConnection = Array.from(this.connectedFeatures.values())
                .find(data =>
                    data.connection?.element?.classList.contains('using-main-point') ||
                    data.connection?.element?.classList.contains('main')
                );
            return !!mainConnection;
        } catch (error) {
            console.error('Error in _checkMainConnectionExists:', error);
            return false;
        }
    }
    // ==========================
    _checkAttributeVisibility() {
        if (!this.connectedFeatures || this.connectedFeatures.size === 0) {
            return;
        }
        const attributesContent = this.element.querySelector('.attributes-content');
        if (!attributesContent) {
            return;
        }
        const containerRect = attributesContent.getBoundingClientRect();
        const visibleRange = {
            top: containerRect.top,
            bottom: containerRect.bottom
        };
        this.connectedFeatures.forEach((data, type) => {
            const attributeItem = attributesContent.querySelector(`.attribute-item[data-type="${type}"]`);
            if (!attributeItem) return;
            const point = attributeItem.querySelector('.attribute-point');
            if (!point) return;
            const itemRect = attributeItem.getBoundingClientRect();
            const isVisible = (
                itemRect.top >= visibleRange.top &&
                itemRect.bottom <= visibleRange.bottom
            );
            const connection = data.connection;
            if (!connection) return;
            if (!isVisible && !this._hiddenAttributes.has(type)) {
                this._hiddenAttributes.add(type);
                attributeItem.classList.add('out-of-view');
                point.classList.add('hidden');
                if (connection.pathElement) {
                    connection.pathElement.style.display = 'none';
                }
            } else if (isVisible && this._hiddenAttributes.has(type) && !this.isAttributesFolded) {
                this._hiddenAttributes.delete(type);
                attributeItem.classList.remove('out-of-view');
                point.classList.remove('hidden');
                if (connection.pathElement) {
                    connection.pathElement.style.display = '';
                }
            }
        });
    }
    _validateConnections() {
        console.log('Validating connections');
        const attributePoints = this.element.querySelectorAll('.attribute-point[data-type]');
        console.log('Found attribute points:', {
            total: attributePoints.length,
            types: Array.from(attributePoints).map(point => point.dataset.type)
        });
        this.connectedFeatures.forEach((data, type) => {
            console.log(`Validating connection for type: ${type}`, {
                hasConnection: !!data.connection,
                hasSourceNode: !!data.sourceNode,
                weight: data.weight
            });
            const point = this.element.querySelector(`.attribute-point[data-type="${type}"]`);
            if (!point) {
                console.warn(`Missing attribute point for connected type: ${type}`);
            } else {
                point.classList.add('connected');
            }
        });
    }
    _handleIntersectionEntries(entries) {
        const changedTypes = new Set();
        const containerRect = this.element.querySelector('.attributes-content')?.getBoundingClientRect();
        if (!containerRect) return;
        entries.forEach(entry => {
            const point = entry.target;
            const type = point.dataset.type;
            if (!type || !this.connectedFeatures.has(type)) return;
            const isVisible = entry.intersectionRatio > 0.1 &&
                            entry.boundingClientRect.top >= containerRect.top &&
                            entry.boundingClientRect.bottom <= containerRect.bottom;
            const wasHidden = this._hiddenAttributes.has(type);
            if (!isVisible && !wasHidden) {
                this._hiddenAttributes.add(type);
                changedTypes.add(type);
                this._switchConnectionToMainOutput({ type, point });
            } else if (isVisible && wasHidden && !this.isAttributesFolded) {
                this._hiddenAttributes.delete(type);
                changedTypes.add(type);
                this._restoreOriginalConnection(point, type);
            }
        });
        if (changedTypes.size > 0) {
            requestAnimationFrame(() => {
                this.updateConnectionsVisibility();
            });
        }
    }
    _restoreOriginalConnection(point, type) {
        const data = this.connectedFeatures.get(type);
        if (!data?.connection || !data.connection._originalSourcePoint) return;
        const connection = data.connection;
        this._transitioningConnections.add(type);
        connection.element.style.transition = 'all 0.3s ease';
        connection.element.classList.add('transitioning');
        connection.sourcePoint = connection._originalSourcePoint;
        connection.element.classList.remove('using-main-point');
        delete connection._originalSourcePoint;
        if (connection.pathElement) {
            Object.assign(connection.pathElement.style, {
                strokeDasharray: 'none',
                // strokeWidth: '2px',
                opacity: '1'
            });
        }
        point.style.opacity = '1';
        point.style.visibility = 'visible';
        point.style.pointerEvents = 'auto';
        requestAnimationFrame(() => {
            connection.updatePosition();
            setTimeout(() => {
                this._transitioningConnections.delete(type);
                connection.element.classList.remove('transitioning');
            }, 300);
        });
    }
    _handleIntersectionError(changedTypes) {
        changedTypes?.forEach(type => {
            if (this._transitioningConnections.has(type)) {
                this._transitioningConnections.delete(type);
            }
        });
        this.connectedFeatures.forEach((data, type) => {
            const attributePoint = this.element.querySelector(
                `.attribute-point[data-type="${type}"]`
            );
            if (attributePoint) {
                attributePoint.style.opacity = '1';
                attributePoint.style.visibility = 'visible';
                attributePoint.classList.remove('hidden');
            }
        });
    }
    restoreOriginalConnection(type) {
        if (this._transitioningConnections.has(type)) {
            return;
        }
        const data = this.connectedFeatures.get(type);
        if (!data?.connection || !data.connection._originalSourcePoint) {
            return;
        }
        const connection = data.connection;
        this._transitioningConnections.add(type);
        connection.element.style.transition = 'all 0.3s ease';
        connection.element.classList.add('transitioning');
        connection.element.classList.remove('using-main-point');
        connection.sourcePoint = connection._originalSourcePoint;
        delete connection._originalSourcePoint;
        if (connection.pathElement) {
            Object.assign(connection.pathElement.style, {
                strokeDasharray: 'none',
                // strokeWidth: '2px',
                opacity: '1',
                transition: 'all 0.3s ease'
            });
        }
        requestAnimationFrame(() => {
            connection.updatePosition();
            setTimeout(() => {
                this._transitioningConnections.delete(type);
                connection.element.classList.remove('transitioning');
            }, 300);
        });
    }
    restoreOriginalConnection(connection) {
        if (!connection || connection.isDestroyed) return;
        try {
            if (!connection._originalPoint) return;
            connection.sourcePoint = connection._originalPoint;
            connection.element.classList.remove('using-main-point');
            connection.element.style.opacity = '1';
            connection.element.style.pointerEvents = 'auto';
            if (connection.pathElement) {
                Object.assign(connection.pathElement.style, {
                    strokeDasharray: 'none',
                    // strokeWidth: '2px',
                    opacity: '1',
                    transition: 'all 0.3s ease'
                });
            }
            const point = connection._originalPoint;
            if (point) {
                Object.assign(point.style, {
                    opacity: '1',
                    visibility: 'visible',
                    pointerEvents: 'auto',
                    transition: 'all 0.3s ease'
                });
            }
            requestAnimationFrame(() => {
                if (!connection.isDestroyed) {
                    connection.updatePosition();
                }
            });
            delete connection._originalPoint;
        } catch (error) {
            console.error('Error restoring connection:', error);
        }
    }
    restoreOriginalConnection(connection) {
        if (!connection || connection.isDestroyed) return;
        try {
            if (connection._originalSourcePoint) {
                connection.sourcePoint = connection._originalSourcePoint;
                connection.element.classList.remove('using-main-point');
                delete connection._originalSourcePoint;
                if (connection.pathElement) {
                    Object.assign(connection.pathElement.style, {
                        strokeDasharray: 'none',
                        // strokeWidth: '2px',
                        opacity: '1',
                        transition: 'all 0.3s ease'
                    });
                }
                const attributePoint = connection.sourcePoint;
                if (attributePoint) {
                    Object.assign(attributePoint.style, {
                        opacity: '1',
                        visibility: 'visible',
                        pointerEvents: 'auto',
                        transition: 'all 0.3s ease'
                    });
                }
                requestAnimationFrame(() => {
                    if (!connection.isDestroyed) {
                        connection.updatePosition();
                    }
                });
            }
        } catch (error) {
            console.error('Error restoring original connection:', error);
        }
    }
    _recoverFromError() {
        try {
            this._hiddenAttributes = new Set();
            this._isProcessingScroll = false;
            this._pendingUpdates = new Map();
            if (this._scrollTimeout) {
                clearTimeout(this._scrollTimeout);
            }
            const attributePoints = this.element.querySelectorAll('.attribute-point[data-role="output"]');
            attributePoints.forEach(point => {
                point.style.visibility = 'visible';
                point.style.opacity = '1';
                point.classList.remove('hidden');
                point.style.pointerEvents = 'auto';
            });
            const mainOutputPoint = this.element.querySelector('.attributes-output-point');
            if (mainOutputPoint) {
                mainOutputPoint.style.visibility = 'visible';
                mainOutputPoint.style.opacity = '1';
                mainOutputPoint.classList.add('active');
            }
        } catch (error) {
            console.error('Error in recovery process:', error);
        }
    }
    _processIntersectionEntries(entries) {
        const attributesContent = this.element.querySelector('.attributes-content');
        if (!attributesContent) return;
        const containerRect = attributesContent.getBoundingClientRect();
        entries.forEach(entry => {
            const point = entry.target;
            const type = point.dataset.type;
            if (!type || !this.connectedFeatures.has(type)) return;
            const isVisible = entry.isIntersecting &&
                entry.boundingClientRect.top >= containerRect.top - 10 &&
                entry.boundingClientRect.bottom <= containerRect.bottom + 10;
            if (!isVisible && !this._hiddenAttributes?.has(type)) {
                this._hiddenAttributes = this._hiddenAttributes || new Set();
                this._hiddenAttributes.add(type);
                this._switchConnectionToMainOutput({ type, point });
                point.classList.add('hidden');
            } else if (isVisible && this._hiddenAttributes?.has(type) && !this.isAttributesFolded) {
                this._hiddenAttributes.delete(type);
                this.restoreOriginalConnection(type);
                point.classList.remove('hidden');
            }
        });
    }
    handleIntersectionChanges(entries) {
        const changedTypes = new Set();
        entries.forEach(entry => {
            const attributePoint = entry.target;
            const type = attributePoint.dataset.type;
            const wasOutside = this._outsideViewportAttributes.has(type);
            if (!type || !this.connectedFeatures.has(type)) return;
            const isInViewport = entry.intersectionRatio > 0.1;
            if (!isInViewport && !wasOutside) {
                this._outsideViewportAttributes.add(type);
                changedTypes.add(type);
                this._switchConnectionToMainOutput({ type, point: attributePoint });
            } else if (isInViewport && wasOutside) {
                this._outsideViewportAttributes.delete(type);
                changedTypes.add(type);
                if (!this.isAttributesFolded) {
                    this.restoreOriginalConnection(type);
                }
            }
        });
        if (changedTypes.size > 0) {
            this.updateConnectionsState(changedTypes);
            this.dispatchEvent('connectionsUpdated', {
                changedTypes: Array.from(changedTypes),
                outsideViewport: Array.from(this._outsideViewportAttributes)
            });
        }
    }
    updateMultipleConnections(visibilityChanges) {
        requestAnimationFrame(() => {
            visibilityChanges.forEach((isVisible, type) => {
                const connection = this.findConnectionByType(type);
                if (connection) {
                    if (isVisible) {
                        this.restoreOriginalConnection(type);
                    } else {
                        this._switchConnectionToMainOutput({ type });
                    }
                }
            });
        });
    }
    _handleMainFold(mainOutputPoint) {
        try {
            mainOutputPoint.classList.add('active');
            mainOutputPoint.style.opacity = '1';
            mainOutputPoint.style.visibility = 'visible';
            mainOutputPoint.style.pointerEvents = 'auto';
            this.connectedFeatures.forEach((data) => {
                const connection = data.connection;
                if (!connection || connection.sourceNode !== this) return;
                if (!connection._originalSourcePoint) {
                    connection._originalSourcePoint = connection.sourcePoint;
                }
                connection.sourcePoint = mainOutputPoint;
                connection.element.classList.add('using-main-point');
                if (connection.pathElement) {
                    Object.assign(connection.pathElement.style, {
                        strokeDasharray: '4,4',
                        //strokeWidth: '2px',
                        opacity: '0.8',
                        transition: 'all 0.3s ease'
                    });
                }
                const point = connection._originalSourcePoint;
                if (point) {
                    point.style.opacity = '0';
                    point.style.visibility = 'hidden';
                    point.style.pointerEvents = 'none';
                }
                requestAnimationFrame(() => {
                    connection.updatePosition();
                });
            });
        } catch (error) {
            console.error('Error in _handleMainFold:', error);
        }
    }
    updateConnectionsVisibility() {
        if (!this.element || !this.connectedFeatures) return;
        try {
            const mainOutputPoint = this.element.querySelector('.attributes-output-point');
            if (!mainOutputPoint) return;
            const activeConnections = new Map();
            for (const [type, connections] of this.connectedFeatures.entries()) {
                const validConnections = this._ensureConnectionArray(connections)
                    .filter(data => this._isValidConnection(data));
                if (validConnections.length > 0) {
                    activeConnections.set(type, validConnections);
                }
            }
            if (this.isAttributesFolded) {
                this._handleMainFoldState(mainOutputPoint, activeConnections);
            }
            else if (this.foldedGroups && this.foldedGroups.size > 0) {
                this._handleGroupFoldStates(mainOutputPoint, activeConnections);
            }
            else {
                for (const [type, connections] of activeConnections.entries()) {
                    connections.forEach(data => {
                        if (data.connection?._originalSourcePoint) {
                            this.restoreOriginalConnection(data.connection);
                        }
                    });
                }
                mainOutputPoint.classList.remove('active');
                Object.assign(mainOutputPoint.style, {
                    opacity: '0',
                    visibility: 'hidden',
                    pointerEvents: 'none',
                    transition: 'all 0.3s ease'
                });
            }
        } catch (error) {
            console.error('Error updating connections visibility:', error);
        }
    }
    _ensureConnectionArray(connections) {
        if (!connections) return [];
        if (Array.isArray(connections)) return connections;
        return [connections];
    }
    _isValidConnection(data) {
        return data &&
               data.connection &&
               !data.connection.isDestroyed &&
               data.connection.sourceNode &&
               data.connection.targetNode;
    }
    _handleGroupFoldStates(mainOutputPoint, activeConnections) {
        try {
            if (!mainOutputPoint) return;
            const groupConnections = new Map();
            this.foldedGroups.forEach(groupName => {
                if (!groupConnections.has(groupName)) {
                    groupConnections.set(groupName, []);
                }
                this.connectedFeatures.forEach((connections, type) => {
                    if (this._getGroupForType(type) === groupName) {
                        connections.forEach(data => {
                            if (data.connection && !data.connection.isDestroyed) {
                                groupConnections.get(groupName).push({
                                    connection: data.connection,
                                    type: type
                                });
                            }
                        });
                    }
                });
            });
            groupConnections.forEach((connections, groupName) => {
                if (connections.length === 0) return;
                mainOutputPoint.classList.add('active');
                Object.assign(mainOutputPoint.style, {
                    opacity: '1',
                    visibility: 'visible',
                    pointerEvents: 'auto',
                    transition: 'all 0.3s ease'
                });
                connections.forEach(({ connection, type }) => {
                    if (connection.sourceNode === this) {
                        if (!connection._originalSourcePoint) {
                            connection._originalSourcePoint = connection.sourcePoint;
                        }
                        connection.sourcePoint = mainOutputPoint;
                        connection.element.classList.add('using-main-point');
                        if (connection.pathElement) {
                            Object.assign(connection.pathElement.style, {
                                strokeDasharray: '4,4',
                                // strokeWidth: '2px',
                                opacity: '0.8',
                                transition: 'all 0.3s ease'
                            });
                        }
                        const attributePoint = connection._originalSourcePoint;
                        if (attributePoint) {
                            Object.assign(attributePoint.style, {
                                opacity: '0',
                                visibility: 'hidden',
                                pointerEvents: 'none',
                                transition: 'all 0.3s ease'
                            });
                        }
                    }
                });
                requestAnimationFrame(() => {
                    connections.forEach(({ connection }) => {
                        if (!connection.isDestroyed) {
                            connection.updatePosition();
                        }
                    });
                });
            });
        } catch (error) {
            console.error('Error in _handleGroupFoldStates:', error);
        }
    }
    _isAttributePointValid(point) {
        return point &&
               point.classList.contains('attribute-point') &&
               point.parentElement &&
               !point.closest('.attribute-group.collapsed');
    }
    _isGroupFolded(groupName) {
        return this.foldedGroups.has(groupName);
    }
    _getAllGroups() {
        const groups = new Set();
        this.element.querySelectorAll('.attribute-group').forEach(group => {
            const groupName = group.dataset.group;
            if (groupName) {
                groups.add(groupName);
            }
        });
        return groups;
    }
    _getGroupAttributePoints(groupName) {
        const group = this.element.querySelector(`.attribute-group[data-group="${groupName}"]`);
        if (!group) return [];
        return Array.from(group.querySelectorAll('.attribute-point'));
    }
    _updateGroupVisualState(group, isFolded) {
        if (!group) return;
        group.classList.toggle('collapsed', isFolded);
        const toggle = group.querySelector('.group-toggle');
        if (toggle) {
            toggle.textContent = isFolded ? '▶' : '▼';
        }
        const content = group.querySelector('.group-content');
        if (content) {
            Object.assign(content.style, {
                height: isFolded ? '0' : 'auto',
                opacity: isFolded ? '0' : '1',
                overflow: isFolded ? 'hidden' : 'visible',
                transition: 'all 0.3s ease'
            });
        }
        const attributePoints = group.querySelectorAll('.attribute-point');
        attributePoints.forEach(point => {
            Object.assign(point.style, {
                opacity: isFolded ? '0' : '1',
                visibility: isFolded ? 'hidden' : 'visible',
                pointerEvents: isFolded ? 'none' : 'auto',
                transition: 'all 0.3s ease'
            });
        });
    }
    _handleGroupTransition(group, isFolding) {
        return new Promise((resolve) => {
            const content = group.querySelector('.group-content');
            if (!content) {
                resolve();
                return;
            }
            const duration = 300;
            content.style.transition = `height ${duration}ms ease,
                                      opacity ${duration}ms ease`;
            if (isFolding) {
                const startHeight = content.scrollHeight;
                content.style.height = `${startHeight}px`;
                content.offsetHeight;
                content.style.height = '0';
                content.style.opacity = '0';
            } else {
                content.style.transition = 'none';
                content.style.height = 'auto';
                const targetHeight = content.scrollHeight;
                content.style.height = '0';
                content.offsetHeight;
                content.style.transition = `height ${duration}ms ease,
                                          opacity ${duration}ms ease`;
                content.style.height = `${targetHeight}px`;
                content.style.opacity = '1';
            }
            content.addEventListener('transitionend', function handler() {
                content.removeEventListener('transitionend', handler);
                if (!isFolding) {
                    content.style.height = 'auto';
                }
                resolve();
            });
        });
    }
    _updateConnectionVisuals(connection, isUsingMainPoint) {
        if (!connection || !connection.element) return;
        connection.element.classList.toggle('using-main-point', isUsingMainPoint);
        const pathElement = connection.element.querySelector('.connection-line');
        if (pathElement) {
            if (isUsingMainPoint) {
                Object.assign(pathElement.style, {
                    strokeDasharray: '4,4',
                    // strokeWidth: '2px',
                    opacity: '0.8'
                });
            } else {
                Object.assign(pathElement.style, {
                    strokeDasharray: 'none',
                    // strokeWidth: '2px',
                    opacity: '1'
                });
            }
        }
        connection.element.style.transition = 'all 0.3s ease';
    }
    _shouldMaintainMainConnection() {
        const hasCollapsedGroups = Array.from(this.foldedGroups).length > 0;
        const isMainFolded = this.isAttributesFolded;
        return isMainFolded || hasCollapsedGroups;
    }
    _restoreConnection(connection) {
        if (!connection || connection.isDestroyed) return;
        try {
            if (!connection._groupData) return;
            const originalPoint = connection._groupData.sourcePoint;
            if (originalPoint) {
                connection.sourcePoint = originalPoint;
                Object.assign(originalPoint.style, {
                    opacity: '1',
                    visibility: 'visible',
                    pointerEvents: 'auto',
                    transition: 'all 0.3s ease'
                });
            }
            connection.element.classList.remove('using-main-point');
            connection.element.style.opacity = '1';
            connection.element.style.pointerEvents = 'auto';
            if (connection.pathElement) {
                Object.assign(connection.pathElement.style, {
                    strokeDasharray: 'none',
                    // strokeWidth: '2px',
                    opacity: '1',
                    transition: 'all 0.3s ease'
                });
                if (connection._groupData.originalPath) {
                    connection.pathElement.setAttribute('d', connection._groupData.originalPath);
                }
            }
            const hitArea = connection.element.querySelector('.connection-hit-area');
            if (hitArea) {
                hitArea.style.pointerEvents = 'stroke';
            }
            requestAnimationFrame(() => {
                if (!connection.isDestroyed) {
                    connection.updatePosition();
                }
            });
            delete connection._groupData;
            this.dispatchEvent('connectionRestored', {
                connection,
                type: connection.type
            });
        } catch (error) {
            console.error('Error restoring connection:', error);
            if (connection._groupData?.sourcePoint) {
                connection.sourcePoint = connection._groupData.sourcePoint;
                connection.element.style.opacity = '1';
                connection.element.classList.remove('using-main-point');
                delete connection._groupData;
            }
        }
    }
    _handleVisibilityError() {
        this._transitioningConnections.clear();
        this._hiddenAttributes.clear();
        this.connectedFeatures.forEach((data, type) => {
            const connection = data.connection;
            if (connection) {
                connection.element.classList.remove('transitioning', 'using-main-point');
                connection.updatePosition();
            }
        });
    }
    _handleGroupFold(groupName) {
        try {
            console.log(`[Node ${this.id}] _handleGroupFold:`, { groupName });
            const mainOutputPoint = this.element.querySelector('.attributes-output-point');
            if (!mainOutputPoint) {
                console.warn('Main output point not found');
                return;
            }
            const groupConnections = Array.from(this._getGroupConnections(groupName));
            if (!groupConnections.length) {
                console.log('No connections found in group');
                return;
            }
            console.log('Processing connections:', {
                count: groupConnections.length,
                connectionIds: groupConnections.map(c => c.id)
            });
            mainOutputPoint.classList.add('active');
            Object.assign(mainOutputPoint.style, {
                opacity: '1',
                visibility: 'visible',
                pointerEvents: 'auto',
                transition: 'all 0.3s ease'
            });
            groupConnections.forEach(connection => {
                if (!connection || connection.isDestroyed) return;
                try {
                    if (!connection._originalSourcePoint) {
                        connection._originalSourcePoint = connection.sourcePoint;
                    }
                    const attributePoint = connection._originalSourcePoint;
                    if (attributePoint) {
                        Object.assign(attributePoint.style, {
                            opacity: '0',
                            visibility: 'hidden',
                            pointerEvents: 'none',
                            transition: 'all 0.3s ease'
                        });
                    }
                    connection.sourcePoint = mainOutputPoint;
                    connection.element.classList.add('using-main-point');
                    if (connection.pathElement) {
                        Object.assign(connection.pathElement.style, {
                            strokeDasharray: '4,4',
                            // strokeWidth: '2px',
                            opacity: '0.8',
                            transition: 'all 0.3s ease'
                        });
                    }
                } catch (connError) {
                    console.error('Error processing connection:', {
                        connectionId: connection.id,
                        error: connError
                    });
                }
            });
            requestAnimationFrame(() => {
                groupConnections.forEach(conn => {
                    if (!conn.isDestroyed) {
                        conn.updatePosition();
                    }
                });
            });
            const group = this.element.querySelector(`.attribute-group[data-group="${groupName}"]`);
            if (group) {
                group.classList.add('folded');
                const content = group.querySelector('.group-content');
                if (content) {
                    Object.assign(content.style, {
                        height: '0',
                        opacity: '0',
                        overflow: 'hidden',
                        transition: 'all 0.3s ease'
                    });
                }
            }
            console.log('Group fold completed:', {
                groupName,
                processedConnections: groupConnections.length
            });
        } catch (error) {
            console.error('Error in _handleGroupFold:', {
                groupName,
                error
            });
            this._recoverFromFoldError(groupName);
        }
    }
    _recoverFromFoldError(groupName = null) {
        try {
            this.isProcessingFold = false;
            this.connectedFeatures.forEach((data, type) => {
                const connection = data.connection;
                if (!connection || connection.isDestroyed) return;
                connection.element.style.opacity = '1';
                connection.element.style.pointerEvents = 'auto';
                if (connection.pathElement) {
                    Object.assign(connection.pathElement.style, {
                        display: '',
                        visibility: 'visible',
                        strokeDasharray: 'none',
                        //strokeWidth: '2px',
                        opacity: '1',
                        transition: 'none'
                    });
                }
                if (connection._originalSourcePoint) {
                    connection.sourcePoint = connection._originalSourcePoint;
                    delete connection._originalSourcePoint;
                    connection.element.classList.remove('using-main-point');
                }
                connection.updatePosition();
            });
            const selector = groupName ?
                `.attribute-group[data-group="${groupName}"] .attribute-point` :
                '.attribute-point';
            const attributePoints = this.element.querySelectorAll(selector);
            attributePoints.forEach(point => {
                Object.assign(point.style, {
                    opacity: '1',
                    visibility: 'visible',
                    pointerEvents: 'auto',
                    transition: 'none'
                });
            });
            if (groupName) {
                const group = this.element.querySelector(`.attribute-group[data-group="${groupName}"]`);
                if (group) {
                    group.classList.remove('folded');
                    const content = group.querySelector('.group-content');
                    if (content) {
                        Object.assign(content.style, {
                            height: 'auto',
                            opacity: '1',
                            overflow: 'visible',
                            transition: 'none'
                        });
                    }
                }
                this.foldedGroups.delete(groupName);
            }
            const mainOutputPoint = this.element.querySelector('.attributes-output-point');
            if (mainOutputPoint) {
                const shouldBeActive = this.isAttributesFolded || this.foldedGroups.size > 0;
                mainOutputPoint.classList.toggle('active', shouldBeActive);
                Object.assign(mainOutputPoint.style, {
                    opacity: shouldBeActive ? '1' : '0',
                    visibility: shouldBeActive ? 'visible' : 'hidden',
                    pointerEvents: shouldBeActive ? 'auto' : 'none',
                    transition: 'none'
                });
            }
            setTimeout(() => {
                const elements = this.element.querySelectorAll('.attribute-point, .connection-line');
                elements.forEach(el => {
                    el.style.transition = '';
                });
            }, 100);
        } catch (error) {
            console.error('Error in recovery process:', error);
        }
    }
    handleIncomingConnections() {
        const incomingConnections = Array.from(this.connectedFeatures.values())
            .filter(data => data.connection?.targetNode === this)
            .map(data => data.connection)
            .filter(Boolean);
        const mainInputPoint = this.element.querySelector('.attributes-input-point');
        if (!mainInputPoint) return;
        incomingConnections.forEach(connection => {
            if (this.isAttributesFolded) {
                connection.targetPoint = mainInputPoint;
            } else {
                const attributePoint = this.element.querySelector(
                    `.attribute-point[data-type="${connection.type}"]`
                );
                if (attributePoint) {
                    connection.targetPoint = attributePoint;
                }
            }
            requestAnimationFrame(() => {
                connection.updatePosition();
            });
        });
    }
    handleMainConnectionCreated(event) {
        const connection = event.detail?.connection;
        if (!connection) return;
        if (!this.validateConnection(connection)) {
            connection.destroy();
            return;
        }
        if (this.isEmptyFrame) {
            this.updateEmptyFrameStatus();
        }
        this.dispatchEvent('connectionUpdated', {
            connection,
            type: 'main'
        });
    }
    validateConnection(connection) {
        if (!connection.sourceNode || !connection.targetNode) {
            return false;
        }
        const existingConnection = this.findConnectionByType(connection.type);
        if (existingConnection && existingConnection !== connection) {
        }
        return true;
    }
    updateEmptyFrameStatus() {
        if (!this.isEmptyFrame) return;
        let totalConnections = 0;
        this.connectedFeatures.forEach((arr, type) => {
            totalConnections += arr.length;
        });
        const generateBtn = this.element.querySelector('.generate-btn');
        if (generateBtn) {
            generateBtn.style.display = totalConnections >= 2 ? 'block' : 'none';
            generateBtn.disabled = (totalConnections < 2);
        }
        const placeholder = this.element.querySelector('.attributes-placeholder');
        if (placeholder) {
            if (totalConnections >= 2) {
                placeholder.textContent = 'Ready to generate';
            } else {
                placeholder.textContent = `Connect ${2 - totalConnections} more attribute(s) to generate`;
            }
        }
    }
    findConnectionByType(type) {
        if (!this.connectedFeatures.has(type)) return [];
        return this.connectedFeatures.get(type)
            .map(data => data.connection)
            .filter(Boolean);
    }
    validateState() {
        if (!this.element) {
            throw new Error('Node element is missing');
        }
        if (this.isDestroyed) {
            throw new Error('Node has been destroyed');
        }
        return true;
    }
    cleanPrompt(prompt) {
        if (!prompt) return '';
        let cleanedPrompt = prompt
            .replace(/Create an image combining these features:.*?Original elements from:\s*/s, '')
            .replace(/\(\d+%\)/g, '')
            .replace(/Original elements from:.*$/s, '')
            .replace(/\s+/g, ' ')
            .trim();
        return cleanedPrompt;
    }
    setupAttributePoints() {
        console.log('Setting up attribute points');
        const attributesList = this.element.querySelector('.attributes-list');
        if (!attributesList) {
            console.warn('Attributes list container not found');
            return;
        }
        const points = this.element.querySelectorAll('.attribute-point');
        console.log('Found attribute points:', points.length);
        points.forEach(point => {
            const type = point.dataset.type;
            if (type) {
                console.log('Setting up point for type:', type);
                this.setupAttributePoint(point);
            }
        });
        const mainInputPoint = this.element.querySelector('.attributes-input-point');
        if (mainInputPoint) {
            this.mainInputPoint = mainInputPoint;
            mainInputPoint.addEventListener('connectionCreated', this.handleMainConnectionCreated.bind(this));
        }
    }
    handleConnectionCreated(event) {
        try {
            const connection = event.detail?.connection;
            if (!connection) return;
            const type = connection.type;
            const isSource = connection.sourceNode === this;
            const isTarget = connection.targetNode === this;
            if (!(this.connectedFeatures instanceof Map)) {
                this.connectedFeatures = new Map();
            }
            if (!this.connectedFeatures.has(type)) {
                this.connectedFeatures.set(type, []);
            }
            const connections = this.connectedFeatures.get(type);
            const existingIndex = connections.findIndex(data =>
                data && (
                    data.connection === connection ||
                    (data.connection?.sourceNode === connection.sourceNode &&
                     data.connection?.targetNode === connection.targetNode)
                )
            );
            const connectionData = {
                connection,
                sourceNode: connection.sourceNode,
                targetNode: connection.targetNode,
                weight: 0.5,
                features: isTarget && connection.sourceNode?.featureAnalysis?.features?.[type]
                    ? connection.sourceNode.featureAnalysis.features[type]
                    : {},
                group: this._getGroupForType(type)
            };
            if (existingIndex !== -1) {
                connections[existingIndex] = connectionData;
            } else {
                connections.push(connectionData);
            }
            if (isTarget) {
                const point = connection.targetPoint;
                if (point) {
                    point.classList.add('connected');
                    this.updateGenerationStatus();
                }
            }
            if (isSource) {
                const point = connection.sourcePoint;
                if (point) {
                    point.classList.add('connected');
                }
            }
            if (this.isAttributesFolded && isSource) {
                const mainOutputPoint = this.element.querySelector('.attributes-output-point');
                if (mainOutputPoint && connection.sourcePoint !== mainOutputPoint) {
                    this._switchConnectionToMainOutput({
                        type,
                        connection,
                        point: connection.sourcePoint
                    });
                }
            }
        } catch (error) {
            console.error('Error in handleConnectionCreated:', error);
        }
    }
    _setupConnectionObserver(connection) {
        if (!connection || connection._hasObserver) return;
        const observer = new MutationObserver(() => {
            requestAnimationFrame(() => {
                if (!connection.isDestroyed) {
                    connection.updatePosition();
                }
            });
        });
        if (connection.sourcePoint) {
            observer.observe(connection.sourcePoint, {
                attributes: true,
                attributeFilter: ['style', 'class']
            });
        }
        if (connection.targetPoint) {
            observer.observe(connection.targetPoint, {
                attributes: true,
                attributeFilter: ['style', 'class']
            });
        }
        connection._hasObserver = true;
        connection._observer = observer;
    }
    handleConnectionDestroyed(event) {
        try {
            const connection = event.detail?.connection;
            if (!connection) return;
            const type = connection.type;
            const connectionsArray = this.connectedFeatures.get(type);
            if (!connectionsArray) return;
            const index = connectionsArray.findIndex(
                data => data.connection === connection
            );
            if (index >= 0) {
                connectionsArray.splice(index, 1);
                console.log(`Removed connection ${connection.id} from type=${type}`);
            }
            if (connectionsArray.length === 0) {
                this.connectedFeatures.delete(type);
                this.removeInheritedAttribute(type);
                const attributePoint = this.element.querySelector(`.attribute-point[data-type="${type}"]`);
                if (attributePoint) {
                    attributePoint.classList.remove('connected');
                }
            }
            if (this.isEmptyFrame) {
                this.updateGenerationStatus();
            }
        } catch (error) {
            console.error('Error in handleConnectionDestroyed:', error);
        }
    }
    _handleConnectionError(connection) {
        try {
            if (connection) {
                const type = connection.type;
                if (this.connectedFeatures.has(type)) {
                    const data = this.connectedFeatures.get(type);
                    if (data?.connections) {
                        const index = data.connections.findIndex(c => c === connection);
                        if (index !== -1) {
                            data.connections.splice(index, 1);
                        }
                        if (data.connections.length === 0) {
                            this.connectedFeatures.delete(type);
                        }
                    }
                }
                const point = connection.sourcePoint;
                if (point) {
                    point.classList.remove('connected');
                    point.style.border = '';
                    point.style.boxShadow = '';
                    point.dataset.connectionCount = '0';
                }
                if (this.isEmptyFrame) {
                    this.updateGenerationStatus();
                }
            }
        } catch (error) {
            console.error('Error in _handleConnectionError:', error);
        }
    }
    _getAttributeGroup(type) {
        try {
            const attributeItem = this.element.querySelector(`.attribute-item[data-type="${type}"]`);
            const group = attributeItem?.closest('.attribute-group');
            return group?.dataset.group || null;
        } catch (error) {
            console.error('Error in _getAttributeGroup:', error);
            return null;
        }
    }
    removeInheritedAttribute(type) {
        const attributeItem = this.element.querySelector(`.inherited-attribute[data-type="${type}"]`);
        if (attributeItem) {
            attributeItem.remove();
        }
    }
    setupCollapsibleSections() {
        const sections = this.element.querySelectorAll('.section-header');
        sections.forEach(header => {
            header.addEventListener('click', () => {
                const section = header.closest('.section');
                section.classList.toggle('collapsed');
                const toggle = header.querySelector('.section-toggle');
                if (toggle) {
                    toggle.textContent = section.classList.contains('collapsed') ? '▶' : '▼';
                }
            });
        });
    }
    setupAttributeSystem() {
        this.mainInputPoint = this.element.querySelector('.attributes-input-point');
        this.mainOutputPoint = this.element.querySelector('.attributes-output-point');
        if (this.mainInputPoint) {
            this.mainInputPoint.addEventListener('connectionCreated', this.handleMainConnectionCreated.bind(this));
        }
        const foldButton = this.element.querySelector('.attributes-fold-button');
        if (foldButton) {
            foldButton.addEventListener('click', () => this.toggleAttributeFold());
        }
    }
    _getConnectionsData(filterFn = null) {
        try {
            if (!this.connectedFeatures || !(this.connectedFeatures instanceof Map)) {
                console.warn('Invalid connectedFeatures structure:', this.connectedFeatures);
                return [];
            }
            const connections = Array.from(this.connectedFeatures.entries())
                .flatMap(([type, data]) => {
                    const dataArray = Array.isArray(data) ? data : [data];
                    return dataArray
                        .filter(d => d && d.connection && !d.connection.isDestroyed)
                        .map(d => ({
                            connection: d.connection,
                            type,
                            sourceNode: d.connection.sourceNode,
                            targetNode: d.connection.targetNode,
                            weight: d.connection.value || 0.5
                        }));
                });
            return filterFn ? connections.filter(filterFn) : connections;
        } catch (error) {
            console.error('Error in _getConnectionsData:', error);
            return [];
        }
    }
    addConnection(connection, type) {
        try {
            console.log('Adding connection:', {
                connectionId: connection?.id,
                type,
                currentConnections: this.connectedFeatures.get(type)
            });
            if (!this.connectedFeatures.has(type)) {
                this.connectedFeatures.set(type, []);
            }
            const connections = this.connectedFeatures.get(type);
            const connectionData = {
                connection,
                sourceNode: connection.sourceNode,
                targetNode: connection.targetNode,
                weight: connection.value || 0.5,
                type
            };
            const existingIndex = connections.findIndex(
                data => data.connection?.id === connection.id
            );
            if (existingIndex >= 0) {
                connections[existingIndex] = connectionData;
            } else {
                connections.push(connectionData);
            }
            console.log('Connection added successfully:', {
                type,
                connectionsCount: connections.length
            });
        } catch (error) {
            console.error('Error adding connection:', error);
            throw error;
        }
    }
    getConnectionsByType(type) {
        return this.connectedFeatures.get(type) || [];
    }
    getAllConnections() {
        const allConnections = [];
        for (const [type, connections] of this.connectedFeatures) {
            allConnections.push(...connections);
        }
        return allConnections;
    }
    removeConnection(connection, type) {
        try {
            const connections = this.connectedFeatures.get(type);
            if (!connections) return;
            const index = connections.findIndex(
                data => data.connection?.id === connection.id
            );
            if (index >= 0) {
                connections.splice(index, 1);
                if (connections.length === 0) {
                    this.connectedFeatures.delete(type);
                }
            }
        } catch (error) {
            console.error('Error removing connection:', error);
        }
    }
    updateConnectionWeight(connection, type, weight) {
        try {
            const connections = this.connectedFeatures.get(type);
            if (!connections) return;
            const connectionData = connections.find(
                data => data.connection?.id === connection.id
            );
            if (connectionData) {
                connectionData.weight = weight;
            }
        } catch (error) {
            console.error('Error updating connection weight:', error);
        }
    }
    async toggleAttributeFold() {
        if (this.isProcessingFold) return;
        this.isProcessingFold = true;
        try {
            console.log(`[Node ${this.id}] toggleAttributeFold:`, {
                currentState: this.isAttributesFolded
            });
            const mainOutputPoint = this.element.querySelector('.attributes-output-point');
            const attributesContent = this.element.querySelector('.attributes-content');
            const foldButton = this.element.querySelector('.attributes-fold-button');
            if (!mainOutputPoint || !attributesContent) {
                throw new Error('Required elements not found');
            }
            this.isAttributesFolded = !this.isAttributesFolded;
            if (foldButton) {
                foldButton.classList.toggle('folded', this.isAttributesFolded);
                foldButton.textContent = this.isAttributesFolded ? '▼' : '▲';
            }
            const activeConnections = this.getAllConnections().filter(
                ({connection}) => connection.sourceNode === this && !connection.isDestroyed
            );
            console.log('Processing connections:', {
                count: activeConnections.length,
                connectionIds: activeConnections.map(c => c.connection.id)
            });
            if (this.isAttributesFolded) {
                const contentHeight = attributesContent.scrollHeight;
                attributesContent.style.height = contentHeight + 'px';
                attributesContent.offsetHeight;
                Object.assign(attributesContent.style, {
                    height: '0',
                    opacity: '0',
                    overflow: 'hidden',
                    transition: 'all 0.3s ease'
                });
                mainOutputPoint.classList.add('active');
                Object.assign(mainOutputPoint.style, {
                    opacity: '1',
                    visibility: 'visible',
                    pointerEvents: 'auto',
                    transition: 'all 0.3s ease'
                });
                const processedConnections = new Set();
                activeConnections.forEach(({connection}) => {
                    try {
                        if (!connection._originalSourcePoint) {
                            connection._originalSourcePoint = connection.sourcePoint;
                        }
                        const attributePoint = connection._originalSourcePoint;
                        if (attributePoint) {
                            Object.assign(attributePoint.style, {
                                opacity: '0',
                                visibility: 'hidden',
                                pointerEvents: 'none',
                                transition: 'all 0.3s ease'
                            });
                        }
                        connection.sourcePoint = mainOutputPoint;
                        connection.element.classList.add('using-main-point');
                        if (connection.pathElement) {
                            Object.assign(connection.pathElement.style, {
                                strokeDasharray: '4,4',
                                // strokeWidth: '2px',
                                opacity: '0.8',
                                transition: 'all 0.3s ease'
                            });
                        }
                        processedConnections.add(connection.id);
                    } catch (connError) {
                        console.error('Error processing connection:', {
                            connectionId: connection.id,
                            error: connError
                        });
                    }
                });
                if (processedConnections.size > 0) {
                    requestAnimationFrame(() => {
                        activeConnections.forEach(({connection}) => {
                            if (!connection.isDestroyed && processedConnections.has(connection.id)) {
                                connection.updatePosition();
                            }
                        });
                    });
                }
            } else {
                attributesContent.style.height = 'auto';
                const targetHeight = attributesContent.scrollHeight;
                attributesContent.style.height = '0';
                attributesContent.offsetHeight;
                Object.assign(attributesContent.style, {
                    height: `${targetHeight}px`,
                    opacity: '1',
                    overflow: 'hidden',
                    transition: 'all 0.3s ease'
                });
                setTimeout(() => {
                    if (!this.isDestroyed && !this.isAttributesFolded) {
                        attributesContent.style.height = 'auto';
                        attributesContent.style.overflow = 'visible';
                    }
                }, 300);
                const processedConnections = new Set();
                activeConnections.forEach(({connection}) => {
                    try {
                        if (connection._originalSourcePoint) {
                            connection.sourcePoint = connection._originalSourcePoint;
                            connection.element.classList.remove('using-main-point');
                            Object.assign(connection._originalSourcePoint.style, {
                                opacity: '1',
                                visibility: 'visible',
                                pointerEvents: 'auto',
                                transition: 'all 0.3s ease'
                            });
                            if (connection.pathElement) {
                                Object.assign(connection.pathElement.style, {
                                    strokeDasharray: 'none',
                                    // strokeWidth: '2px',
                                    opacity: '1',
                                    transition: 'all 0.3s ease'
                                });
                            }
                            delete connection._originalSourcePoint;
                            processedConnections.add(connection.id);
                        }
                    } catch (connError) {
                        console.error('Error restoring connection:', {
                            connectionId: connection.id,
                            error: connError
                        });
                    }
                });
                if (!this._hasAnyFoldedGroups()) {
                    mainOutputPoint.classList.remove('active');
                    Object.assign(mainOutputPoint.style, {
                        opacity: '0',
                        visibility: 'hidden',
                        pointerEvents: 'none',
                        transition: 'all 0.3s ease'
                    });
                }
                if (processedConnections.size > 0) {
                    requestAnimationFrame(() => {
                        activeConnections.forEach(({connection}) => {
                            if (!connection.isDestroyed && processedConnections.has(connection.id)) {
                                connection.updatePosition();
                            }
                        });
                    });
                }
            }
            this.dispatchEvent('attributeFoldChanged', {
                isFolded: this.isAttributesFolded,
                nodeId: this.id
            });
        } catch (error) {
            console.error('Error in toggleAttributeFold:', error);
            this._recoverFromFoldError();
        } finally {
            setTimeout(() => {
                this.isProcessingFold = false;
            }, 350);
        }
    }
    handleAttributeFoldChanged(event) {
        try {
            const isFolded = event.detail.isFolded;
            const attributeGroups = this.element.querySelectorAll('.attribute-group');
            attributeGroups.forEach(group => {
                if (isFolded) {
                    if (!group.classList.contains('collapsed')) {
                        group.classList.add('collapsed');
                        const toggle = group.querySelector('.group-toggle');
                        if (toggle) toggle.textContent = '▶';
                    }
                }
            });
            const mainOutputPoint = this.element.querySelector('.attributes-output-point');
            if (mainOutputPoint) {
                mainOutputPoint.style.opacity = isFolded ? '1' : '0';
                mainOutputPoint.style.pointerEvents = isFolded ? 'auto' : 'none';
                mainOutputPoint.classList.toggle('active', isFolded);
            }
            this.connectedFeatures.forEach((data, type) => {
                const connection = data.connection;
                if (!connection) return;
                const attributeItem = this.element.querySelector(`.attribute-item[data-type="${type}"]`);
                const point = attributeItem?.querySelector('.attribute-point');
                if (isFolded) {
                    this._hiddenAttributes.add(type);
                    if (point) {
                        point.style.opacity = '0';
                        point.style.visibility = 'hidden';
                    }
                    this._switchConnectionToMainOutput({ type, point });
                } else {
                    this._hiddenAttributes.delete(type);
                    if (point && !attributeItem?.closest('.attribute-group.collapsed')) {
                        point.style.opacity = '1';
                        point.style.visibility = 'visible';
                        this.restoreOriginalConnection(type);
                    }
                }
                connection.setFolded(isFolded);
                requestAnimationFrame(() => {
                    connection.updatePosition();
                });
            });
            this.dispatchEvent('attributesFoldStateChanged', {
                node: this,
                isFolded: isFolded
            });
        } catch (error) {
            console.error('Error in handleAttributeFoldChanged:', error);
        }
    }
    handleConversionError(savedElement, savedPosition, savedConnections) {
        try {
            if (savedElement && this.element && this.element.parentNode) {
                this.element.parentNode.replaceChild(savedElement, this.element);
            }
            this.element = savedElement;
            if (savedPosition) {
                this.position = savedPosition;
                this.setPosition(savedPosition.x, savedPosition.y);
            }
            if (savedConnections) {
                this.connectedFeatures = new Map();
                savedConnections.forEach((connections, type) => {
                    this.connectedFeatures.set(type, connections);
                });
                requestAnimationFrame(() => {
                    this.connectedFeatures.forEach(connections => {
                        connections.forEach(data => {
                            if (data.connection && !data.connection.isDestroyed) {
                                data.connection.updatePosition();
                            }
                        });
                    });
                });
            }
        } catch (error) {
            console.error('Error in recovery process:', error);
        }
    }
    createElement() {
        const element = document.createElement('div');
        element.className = `node ${this.isEmptyFrame ? 'empty-frame' : ''}`;
        element.dataset.nodeId = this.id;
        element.style.position = 'absolute';
        element.innerHTML = `
            <div class="node-header">
                <button class="node-close-btn">×</button>
            </div>
            <div class="node-content">
                ${this.imageUrl ?
                    `<div class="image-container">
                        <img src="${this.imageUrl}" alt="${this.prompt || ''}" draggable="false">
                     </div>` :
                    `<div class="generation-container">
                        <div class="generation-label">Generation Frame</div>
                        ${this.getGenerateButton()}
                     </div>`
                }
                <div class="sections-container">
                    <div class="section attributes-section ${this.isAttributesFolded ? 'folded' : ''}">
                        <div class="section-header">
                            ${!this.isEmptyFrame ?
                                `<div class="attributes-output-point" data-type="main"></div>` :
                                ''}
                            <div class="attributes-input-point" data-type="main"></div>
                            <span class="section-title">Attributes</span>
                            <button class="attributes-fold-button">
                                ${this.isAttributesFolded ? '▼' : '▲'}
                            </button>
                        </div>
                        <div class="section-content attributes-content">
                            <div class="attributes-list"></div>
                            ${this.isEmptyFrame ?
                                `<div class="attributes-placeholder">
                                    Connect 2 or more attributes to generate
                                </div>` :
                                ''}
                        </div>
                    </div>
                    ${this.prompt ?
                        `<div class="section prompt-section">
                            <div class="section-header">
                                <span class="section-title">Prompt</span>
                                <span class="group-toggle">▼</span>
                            </div>
                            <div class="section-content prompt-content">
                                ${this.prompt}
                            </div>
                        </div>` :
                        ''}
                </div>
            </div>`;
        return element;
    }
    generateNodeHTML() {
        return `
            <div class="node-header">
                <button class="node-close-btn">×</button>
            </div>
            <div class="node-content">
                ${this.imageUrl ?
                    `<div class="image-container">
                        <img src="${this.imageUrl}" alt="${this.prompt || ''}" draggable="false">
                     </div>` :
                    `<div class="generation-container">
                        <div class="generation-label">Generation Frame</div>
                        ${this.getGenerateButton()}
                     </div>`
                }
                <div class="sections-container">
                    <div class="section attributes-section ${this.isAttributesFolded ? 'folded' : ''}">
                        <div class="section-header">
                            ${!this.isEmptyFrame ?
                                `<div class="attributes-output-point" data-type="main"></div>` :
                                ''}
                            <div class="attributes-input-point" data-type="main"></div>
                            <span class="section-title">Attributes</span>
                            <button class="attributes-fold-button">${this.isAttributesFolded ? '▼' : '▲'}</button>
                        </div>
                        <div class="section-content attributes-content">
                            <div class="attributes-list"></div>
                            ${this.isEmptyFrame ?
                                `<div class="attributes-placeholder">
                                    Connect 2 or more attributes to generate
                                </div>` :
                                ''}
                        </div>
                    </div>
                    ${this.prompt ?
                        `<div class="section prompt-section">
                            <div class="section-header">
                                <span class="section-title">Prompt</span>
                                <button class="section-toggle">▼</button>
                            </div>
                            <div class="section-content prompt-content">
                                ${this.prompt}
                            </div>
                        </div>` :
                        ''}
                </div>
            </div>`;
    }
    /**
 *
 * @param {string} type
 * @param {Object} features
 * @param {number} confidence
 * @returns {HTMLElement}
 */
    createAttributeItem(type, features, confidence) {
        try {
            console.log('Creating attribute item:', { type, features, confidence });
            const item = document.createElement('div');
            item.className = `attribute-item ${type}`;
            item.dataset.type = type;
            const header = document.createElement('div');
            header.className = 'attribute-header';
            header.style.position = 'relative';
            const label = document.createElement('span');
            label.className = 'attribute-label';
            label.textContent = type.charAt(0).toUpperCase() + type.slice(1);
            const confidenceScore = document.createElement('div');
            confidenceScore.className = 'confidence-score';
            confidenceScore.textContent = `${Math.round(confidence * 100)}%`;
            const point = document.createElement('div');
            point.className = 'attribute-point';
            point.dataset.type = type;
            point.dataset.role = 'output';
            Object.assign(point.style, {
                position: 'absolute',
                right: '-6px',
                top: '50%',
                width: '8px',
                height: '8px',
                background: 'white',
                borderRadius: '50%',
                transform: 'translateY(-50%)',
                cursor: 'pointer',
                zIndex: '1000',
                border: `2px solid var(--feature-${type}-base)`
            });
            header.appendChild(label);
            header.appendChild(confidenceScore);
            header.appendChild(point);
            item.appendChild(header);
            const featuresContainer = document.createElement('div');
            featuresContainer.className = 'detected-features';
            if (!this.disabledFeatures) {
                this.disabledFeatures = new Set();
            }
            Object.entries(features)
                .sort(([,a], [,b]) => b - a)
                .forEach(([feature, score]) => {
                    const tag = document.createElement('span');
                    tag.className = 'feature-tag';
                    tag.textContent = feature;
                    tag.dataset.score = score;
                    tag.dataset.enabled = 'true';
                    tag.style.opacity = 0.3 + (score * 0.7);
                    const featureKey = `${type}:${feature}`;
                    if (this.disabledFeatures.has(featureKey)) {
                        tag.classList.add('disabled');
                        tag.dataset.enabled = 'false';
                    }
                    tag.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const isEnabled = tag.dataset.enabled === 'true';
                        const newState = !isEnabled;
                        tag.dataset.enabled = newState.toString();
                        tag.classList.toggle('disabled', !newState);
                        if (newState) {
                            this.disabledFeatures.delete(featureKey);
                        } else {
                            this.disabledFeatures.add(featureKey);
                        }
                        this.updateFeatureWeights(type);
                        this.dispatchEvent('featureStateChanged', {
                            type,
                            feature,
                            enabled: newState,
                            score
                        });
                    });
                    featuresContainer.appendChild(tag);
                });
            item.appendChild(featuresContainer);
            this.setupAttributePoint(point);
            return item;
        } catch (error) {
            console.error('Error creating attribute item:', error);
            throw error;
        }
    }
    getGenerateButton() {
        return this.isEmptyFrame ?
            `<button class="generate-btn" style="display: none;">
                Generate
            </button>` : '';
    }
    setupConnectionPoints() {
        const container = this.element.querySelector('.attributes-list');
        if (!container) return;
        Object.keys(this.featureAnalysis?.features || {}).forEach(category => {
            const point = document.createElement('div');
            point.className = 'attribute-point';
            point.dataset.type = category;
            container.appendChild(point);
            if (!this.isEmptyFrame) {
                this.setupDraggablePoint(point);
            }
        });
        this.element.addEventListener('connectionStart', e => {
            if (!this.isEmptyFrame) return;
            const { type, sourceNode } = e.detail;
            if (this.connectedFeatures.has(type)) return;
            this.connectedFeatures.set(type, {
                sourceNode,
                weight: 0.5
            });
            this.updateGenerateButton();
        });
    }
    updateGenerateButton() {
        const generateBtn = this.element.querySelector('.generate-btn');
        if (!generateBtn) return;
        const canGenerate = this.connectedFeatures.size >= 2;
        generateBtn.style.display = canGenerate ? 'block' : 'none';
    }
    async handleGenerate() {
    if (!this.canGenerate()) return;
    try {
        this.isGenerating = true;
        this.updateGenerationStatus();

        const features = {};
        for (const [type, connections] of this.connectedFeatures.entries()) {
            for (const data of connections) {
                if (data.connection?.targetNode !== this) continue;
                const sourceNode = data.sourceNode;
                if (!sourceNode?.featureAnalysis?.features?.[type]) continue;
                features[type] = {
                    sourcePrompt: sourceNode.prompt,
                    weight: data.weight || 0.5,
                    features: sourceNode.featureAnalysis.features[type],
                    analysis: sourceNode.featureAnalysis
                };
            }
        }

        if (Object.keys(features).length < 2) {
            throw new Error('Need at least 2 connected features to generate');
        }

        const modelSelect = document.getElementById('model-select');
        const sizeSelect = document.getElementById('size-select');
        const currentModel = modelSelect ? modelSelect.value : 'dall-e-3';
        const currentSize = sizeSelect ? sizeSelect.value : '1024x1024';

        console.log(`Using model: ${currentModel}, size: ${currentSize} for interpolation`);

        const response = await fetch('/api/interpolate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                features,
                model: currentModel,
                size: currentSize,
                quality: 'standard'
            })
        });

        if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
        }

        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error || 'Generation failed');
        }

        await this.convertToImageNode(
            result.url,
            result.prompt,
            result.analysis
        );
    } catch (error) {
        console.error('Generate image error:', error);
        this.showError(error.message);
    } finally {
        this.isGenerating = false;
        this.updateGenerationStatus();
    }
}

    resetInteractionState() {
        if (this.element) {
            this.element.style.pointerEvents = 'auto';
            const controls = this.element.querySelectorAll('button, input, .attribute-point');
            controls.forEach(control => {
                control.disabled = false;
                control.style.pointerEvents = 'auto';
            });
            const attributesSection = this.element.querySelector('.attributes-section');
            if (attributesSection) {
                attributesSection.style.pointerEvents = 'auto';
                attributesSection.style.opacity = '1';
            }
        }
    }
    generatePrompt(features) {
        let prompt = '';
        Object.entries(features).forEach(([type, data]) => {
            const descriptors = Object.keys(data.descriptors);
            if (descriptors.length) {
                prompt += `${type}: ${descriptors.join(', ')} (${Math.round(data.weight * 100)}%)\n`;
            }
        });
        return prompt;
    }
    async getImageData() {
        try {
            if (!this.imageUrl) {
                return null;
            }
            if (this.imageUrl.startsWith('data:image')) {
                return this.imageUrl;
            }
            const response = await fetch('/api/proxy-image', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    url: this.imageUrl
                })
            });
            if (!response.ok) {
                throw new Error(`Failed to fetch image: ${response.status}`);
            }
            const result = await response.json();
            return result.data;
        } catch (error) {
            console.error('Error getting image data:', error);
            throw error;
        }
    }
    async analyzeFeatures() {
    try {
        if (!this.prompt && !this.imageUrl) {
            throw new Error('No content to analyze');
        }

        this.setAnalysisStatus('Analyzing features...');
        this.isAnalyzing = true;

        let imageData = null;
        if (this.imageUrl) {
            try {
                imageData = await this.getImageData();
            } catch (error) {
                console.warn('Image processing failed:', error);
                this.setAnalysisStatus('Warning: Image processing failed, analyzing prompt only...', true);
            }
        }

        const response = await fetch('/api/analyze', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                prompt: this.prompt,
                image_data: imageData
            })
        });

        if (!response.ok) {
            throw new Error(`Analysis request failed: ${response.status}`);
        }

        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error || 'Analysis failed');
        }

        if (result.analysis) {
            this.featureAnalysis = { features: result.analysis };
        } else {
            this.featureAnalysis = result;
        }

        console.log('Feature analysis set:', this.featureAnalysis);

        await this.updateAttributesDisplay();
        this.setAnalysisStatus('Analysis complete');
        return result;

    } catch (error) {
        console.error('Analysis error:', error);
        this.setAnalysisStatus(`Error: ${error.message}`, true);
        throw error;
    } finally {
        this.isAnalyzing = false;
    }
}
    async updateAttributesDisplay() {
    try {
        console.log('Starting updateAttributesDisplay');
        console.log('Current feature analysis:', this.featureAnalysis);

        const attributesContent = this.element.querySelector('.attributes-content');
        if (!attributesContent) {
            console.warn('Attributes content container not found');
            return;
        }

        let attributesList = attributesContent.querySelector('.attributes-list');
        if (!attributesList) {
            attributesList = document.createElement('div');
            attributesList.className = 'attributes-list';
            attributesContent.appendChild(attributesList);
        }


        attributesList.innerHTML = '';


        if (this.isEmptyFrame) {
            console.log('Creating empty frame placeholder');
            const placeholder = document.createElement('div');
            placeholder.className = 'attributes-placeholder';
            placeholder.textContent = 'Connect 2 or more attributes to generate';
            attributesList.appendChild(placeholder);
            return;
        }


        const features = this.featureAnalysis?.features || this.featureAnalysis;

        if (!features || typeof features !== 'object' || Object.keys(features).length === 0) {
            console.warn('No feature analysis data available');
            console.log('Feature analysis object:', this.featureAnalysis);
            const placeholder = document.createElement('div');
            placeholder.className = 'attributes-placeholder';
            placeholder.textContent = 'No attributes detected';
            attributesList.appendChild(placeholder);
            return;
        }

        console.log('Using features:', features);


        const groups = {
            appearance: {
                title: 'Appearance',
                types: ['color', 'style', 'object']
            },
            composition: {
                title: 'Composition',
                types: ['composition', 'perspective', 'detail']
            },
            atmosphere: {
                title: 'Atmosphere',
                types: ['lighting', 'mood', 'texture']
            }
        };


        for (const [groupKey, groupData] of Object.entries(groups)) {
            console.log(`Processing group: ${groupKey}`);


            const hasFeatures = groupData.types.some(type => {
                const typeFeatures = features[type];
                return typeFeatures && Object.keys(typeFeatures).length > 0;
            });

            if (!hasFeatures) {
                console.log(`No features found for group: ${groupKey}`);
                continue;
            }


            const group = this.createAttributeGroup(groupKey, groupData);
            const content = group.querySelector('.group-content');


            for (const type of groupData.types) {
                const typeFeatures = features[type];
                if (!typeFeatures || Object.keys(typeFeatures).length === 0) continue;

                console.log(`Creating attribute item for type: ${type}`, typeFeatures);


                const item = document.createElement('div');
                item.className = `attribute-item ${type}`;
                item.dataset.type = type;


                const header = document.createElement('div');
                header.className = 'attribute-header';
                header.style.position = 'relative';


                const label = document.createElement('span');
                label.className = 'attribute-label';
                label.textContent = type.charAt(0).toUpperCase() + type.slice(1);

                const confidenceScore = document.createElement('div');
                confidenceScore.className = 'confidence-score';


                const avgConfidence = Object.values(typeFeatures).reduce((sum, val) => sum + val, 0) / Object.values(typeFeatures).length;
                confidenceScore.textContent = `${Math.round(avgConfidence * 100)}%`;


                const attributePoint = document.createElement('div');
                attributePoint.className = 'attribute-point';
                attributePoint.dataset.type = type;

                header.appendChild(label);
                header.appendChild(confidenceScore);
                header.appendChild(attributePoint);


                const featuresContainer = document.createElement('div');
                featuresContainer.className = 'detected-features';


                Object.entries(typeFeatures)
                    .sort(([,a], [,b]) => b - a)
                    .forEach(([feature, confidence]) => {
                        const tag = document.createElement('span');
                        tag.className = 'feature-tag';
                        tag.textContent = feature;
                        tag.style.opacity = 0.3 + (confidence * 0.7);
                        tag.title = `${feature}: ${Math.round(confidence * 100)}%`;
                        featuresContainer.appendChild(tag);
                    });

                item.appendChild(header);
                item.appendChild(featuresContainer);
                content.appendChild(item);
            }

            attributesList.appendChild(group);
        }


        if (attributesList.children.length === 0) {
            const placeholder = document.createElement('div');
            placeholder.className = 'attributes-placeholder';
            placeholder.textContent = 'No attributes detected';
            attributesList.appendChild(placeholder);
        } else {
            console.log(`Successfully created ${attributesList.children.length} attribute groups`);
        }


        this.setupAttributePoints();

        console.log('Attributes display updated successfully');

    } catch (error) {
        console.error('Error updating attributes display:', error);

        const attributesContent = this.element.querySelector('.attributes-content');
        if (attributesContent) {
            let attributesList = attributesContent.querySelector('.attributes-list');
            if (!attributesList) {
                attributesList = document.createElement('div');
                attributesList.className = 'attributes-list';
                attributesContent.appendChild(attributesList);
            }
            attributesList.innerHTML = '';

            const placeholder = document.createElement('div');
            placeholder.className = 'attributes-placeholder error';
            placeholder.textContent = 'Error displaying attributes';
            attributesList.appendChild(placeholder);
        }
    }
}
    createAttributeGroup(groupKey, groupData) {
        try {

            const group = document.createElement('div');
            group.className = 'attribute-group';
            group.dataset.group = groupKey;

            const header = document.createElement('div');
            header.className = 'group-header';
            const titleSpan = document.createElement('span');
            titleSpan.textContent = groupData.title;
            const toggleSpan = document.createElement('span');
            toggleSpan.className = 'group-toggle';
            toggleSpan.textContent = '▼';
            header.appendChild(titleSpan);
            header.appendChild(toggleSpan);

            const content = document.createElement('div');
            content.className = 'group-content';

            content.style.transition = 'all 0.3s ease';

            group.appendChild(header);
            group.appendChild(content);

            header.addEventListener('click', (e) => {
                if (!e.target.closest('.attribute-point')) {
                    const groupName = group.dataset.group;
                    if (this.handleGroupToggle) {
                        this.handleGroupToggle(groupName);
                    } else {
                        console.warn('handleGroupToggle not found');
                    }
                }
            });

            if (this.foldedGroups.has(groupKey)) {
                group.classList.add('collapsed');
                toggleSpan.textContent = '▶';
                content.style.height = '0';
                content.style.opacity = '0';
                content.style.overflow = 'hidden';
            }
            return group;
        } catch (error) {
            console.error('Error creating attribute group:', error);
            throw error;
        }
    }
    showPlaceholder(container) {
        const placeholder = document.createElement('div');
        placeholder.className = 'attributes-placeholder';
        if (this.isEmptyFrame) {
            placeholder.textContent = 'Connect 2 or more attributes to generate';
        } else {
            placeholder.textContent = 'No attributes detected';
        }
        container.appendChild(placeholder);
    }
    updateEmptyState() {
        const placeholder = this.element.querySelector('.attributes-placeholder');
        if (!placeholder) return;
        const hasConnections = this.connectedFeatures.size > 0;
        const canGenerate = this.connectedFeatures.size >= 2;
        placeholder.style.display = hasConnections ? 'none' : 'block';
        placeholder.textContent = canGenerate ?
            'Ready to generate' :
            `Connect ${Math.max(2 - this.connectedFeatures.size, 0)} more attribute${this.connectedFeatures.size === 1 ? '' : 's'} to generate`;
    }
    setupEventListeners() {
        if (!this.element) return;
        try {

            this.element.querySelectorAll('.group-header').forEach(header => {
                header.addEventListener('click', (e) => {

                    if (!e.target.closest('.attribute-point')) {
                        const group = header.closest('.attribute-group');
                        if (group) {
                            const groupName = group.dataset.group;
                            this.handleGroupToggle(groupName);
                        }
                    }
                });
            });

            const closeBtn = this.element.querySelector('.node-close-btn');
            if (closeBtn) {
                closeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.destroy();
                });
            }

            const foldBtn = this.element.querySelector('.attributes-fold-button');
            if (foldBtn) {
                foldBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.toggleAttributeFold();
                });
            }

            const generateBtn = this.element.querySelector('.generate-btn');
            if (generateBtn) {
                generateBtn.addEventListener('click', () => {
                    if (!this.isProcessing && this.canGenerate()) {
                        this.handleGenerate().catch(error => {
                            console.error('Generation failed:', error);
                            this.showError('Failed to generate image');
                        });
                    }
                });
            }

            const attributePoints = this.element.querySelectorAll('.attribute-point');
            attributePoints.forEach(point => {
                this.setupAttributePoint(point);
            });

            document.addEventListener('connectionDestroyed', this.handleConnectionDestroyed);
            document.addEventListener('connectionValueChanged', this.handleFeatureUpdate);
            document.addEventListener('connectionStart', this.boundHandleConnectionStart);
            document.addEventListener('connectionMove', this.boundHandleConnectionMove);
            document.addEventListener('connectionEnd', this.boundHandleConnectionEnd);

            const attributesContent = this.element.querySelector('.attributes-content');
            if (attributesContent) {
                attributesContent.addEventListener('scroll', () => {
                    if (this._scrollTimeout) {
                        clearTimeout(this._scrollTimeout);
                    }
                    this._scrollTimeout = setTimeout(() => {
                        this._checkAttributeVisibility();
                    }, 100);
                });
            }
        } catch (error) {
            console.error('Error in setupEventListeners:', error);
        }
    }
    handleDragStart(event) {
        this.isDragging = true;
        const startPosition = { x: event.clientX, y: event.clientY };
        const handleDragMove = (moveEvent) => {
            const currentPosition = { x: moveEvent.clientX, y: moveEvent.clientY };
            this.updateConnections(currentPosition);
        };
        const handleDragEnd = () => {
            this.isDragging = false;
            document.removeEventListener('mousemove', handleDragMove);
            document.removeEventListener('mouseup', handleDragEnd);
        };
        document.addEventListener('mousemove', handleDragMove);
        document.addEventListener('mouseup', handleDragEnd);
    }
    toggleSection(section) {
        section.classList.toggle('collapsed');
        const toggle = section.querySelector('.section-toggle');
        if (toggle) {
            toggle.textContent = section.classList.contains('collapsed') ? '▶' : '▼';
        }
    }
    setupDragging() {
        let isDragging = false;
        let startX, startY;
        let startNodeX, startNodeY;
        const onDragStart = (e) => {
            if (e.target.classList.contains('attribute-point') ||
                e.target.closest('.section-header') ||
                e.target.closest('.node-header') ||
                this.isProcessing ||
                this.isDragging) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            this.isDragging = true;
            this.element.classList.add('dragging');
            this.element.style.zIndex = '1000';
            this.element.style.cursor = 'grabbing';
            const canvasRect = this.element.parentElement.getBoundingClientRect();
            startX = e.clientX - canvasRect.left;
            startY = e.clientY - canvasRect.top;
            startNodeX = this.position.x;
            startNodeY = this.position.y;
            document.addEventListener('mousemove', onDragMove);
            document.addEventListener('mouseup', onDragEnd);
            this.dispatchEvent('dragStart', {
                node: this,
                position: { x: startNodeX, y: startNodeY }
            });
        };
        const onDragMove = (e) => {
            if (!this.isDragging) return;
            e.preventDefault();
            try {
                const canvasRect = this.element.parentElement.getBoundingClientRect();
                const dx = (e.clientX - canvasRect.left) - startX;
                const dy = (e.clientY - canvasRect.top) - startY;
                let newX = startNodeX + dx;
                let newY = startNodeY + dy;
                const container = this.element.parentElement;
                const nodeRect = this.element.getBoundingClientRect();
                const maxX = container.offsetWidth - nodeRect.width;
                const maxY = container.offsetHeight - nodeRect.height;
                newX = Math.max(0, Math.min(newX, maxX));
                newY = Math.max(0, Math.min(newY, maxY));
                this.setPosition(newX, newY, true);
                if (this.updateConnections) {
                    this.updateConnections();
                }
                this.dispatchEvent('nodeDrag', {
                    node: this,
                    position: { x: newX, y: newY }
                });
            } catch (error) {
                console.error('Error during drag move:', error);
                this.setPosition(startNodeX, startNodeY);
            }
        };
        const onDragEnd = (e) => {
            if (!this.isDragging) return;
            e.preventDefault();
            this.isDragging = false;
            this.element.classList.remove('dragging');
            this.element.style.zIndex = '';
            this.element.style.cursor = 'move';
            document.removeEventListener('mousemove', onDragMove);
            document.removeEventListener('mouseup', onDragEnd);
            const finalPosition = {
                x: this.position.x,
                y: this.position.y
            };
            this.setPosition(finalPosition.x, finalPosition.y);
            requestAnimationFrame(() => {
                if (this.updateConnections) {
                    this.updateConnections();
                }
            });
            this.dispatchEvent('dragEnd', {
                node: this,
                position: finalPosition
            });
            this.dispatchEvent('nodeMoved', {
                node: this,
                position: finalPosition
            });
        };
        if (this.element) {
            this.element.removeEventListener('mousedown', onDragStart);
            this.element.addEventListener('mousedown', onDragStart);
        }
        this._dragCleanup = () => {
            if (this.element) {
                this.element.removeEventListener('mousedown', onDragStart);
            }
            document.removeEventListener('mousemove', onDragMove);
            document.removeEventListener('mouseup', onDragEnd);
            this.isDragging = false;
            if (this.element) {
                this.element.classList.remove('dragging');
                this.element.style.removeProperty('z-index');
                this.element.style.cursor = 'move';
            }
        };
    }
    setupAttributePoint(point) {
        if (!point || !point.dataset.type) return null;

        const oldListeners = point._eventListeners || {};
        Object.keys(oldListeners).forEach(type => {
            point.removeEventListener(type, oldListeners[type]);
        });
        point._eventListeners = {};

        Object.assign(point.style, {
            position: 'absolute',
            right: '-6px',
            top: '50%',
            width: '8px',
            height: '8px',
            background: 'white',
            borderRadius: '50%',
            transform: 'translateY(-50%)',
            cursor: 'pointer',
            zIndex: '1000',
            border: `2px solid var(--feature-${point.dataset.type}-base)`,
            transition: 'transform 0.2s ease, box-shadow 0.2s ease'
        });
        let isConnecting = false;
        let startX, startY;
        const startConnection = (e) => {
            if (e.button !== 0 || this.isProcessing || isConnecting) return;
            e.preventDefault();
            e.stopPropagation();
            isConnecting = true;
            const rect = point.getBoundingClientRect();
            startX = rect.left + rect.width/2;
            startY = rect.top + rect.height/2;
            point.classList.add('connecting');
            point.style.transform = 'translateY(-50%) scale(1.2)';
            const detail = {
                node: this,
                point: point,
                type: point.dataset.type,
                x: startX,
                y: startY,
                isAttributeConnection: true,
                sourceNode: this
            };
            document.dispatchEvent(new CustomEvent('connectionStart', {
                bubbles: true,
                detail
            }));
            document.addEventListener('mousemove', moveConnection);
            document.addEventListener('mouseup', endConnection);
        };
        const moveConnection = (e) => {
            if (!isConnecting) return;
            e.preventDefault();
            document.dispatchEvent(new CustomEvent('connectionMove', {
                bubbles: true,
                detail: {
                    x: e.clientX,
                    y: e.clientY
                }
            }));
        };
        const endConnection = (e) => {
            if (!isConnecting) return;
            e.preventDefault();
            isConnecting = false;
            point.classList.remove('connecting');
            point.style.transform = 'translateY(-50%)';
            point.style.boxShadow = 'none';
            document.removeEventListener('mousemove', moveConnection);
            document.removeEventListener('mouseup', endConnection);
            document.dispatchEvent(new CustomEvent('connectionEnd', {
                bubbles: true,
                detail: {
                    x: e.clientX,
                    y: e.clientY
                }
            }));
        };
        point._eventListeners = {
            mousedown: startConnection,
            dragstart: (e) => e.preventDefault()
        };
        Object.entries(point._eventListeners).forEach(([type, listener]) => {
            point.addEventListener(type, listener);
        });
        return point;
     }
    canStartConnection(node, point, type) {
        if (!point.classList.contains('attribute-point')) {
            return false;
        }
        return true;
    }
    findConnectionByPoint(point) {
        return Array.from(this.connectedFeatures.values())
            .find(data => data.connection?.sourcePoint === point)?.connection;
    }
    createAttributeElement(type, features, confidence) {
        console.log('Creating attribute element:', { type, features, confidence });
        const attributeDiv = document.createElement('div');
        attributeDiv.className = 'attribute-item';
        attributeDiv.dataset.type = type;
        const headerDiv = document.createElement('div');
        headerDiv.className = 'attribute-header';
        const label = document.createElement('span');
        label.className = 'attribute-label';
        label.textContent = type;
        const confidenceSpan = document.createElement('span');
        confidenceSpan.className = 'confidence-score';
        confidenceSpan.textContent = `${Math.round(confidence * 100)}%`;
        const point = document.createElement('div');
        point.className = 'attribute-point';
        point.dataset.type = type;
        headerDiv.appendChild(label);
        headerDiv.appendChild(confidenceSpan);
        headerDiv.appendChild(point);
        attributeDiv.appendChild(headerDiv);
        const featuresDiv = document.createElement('div');
        featuresDiv.className = 'detected-features';
        Object.keys(features).forEach(feature => {
            const featureSpan = document.createElement('span');
            featureSpan.className = 'feature-tag';
            featureSpan.textContent = feature;
            featuresDiv.appendChild(featureSpan);
        });
        attributeDiv.appendChild(featuresDiv);
        return attributeDiv;
    }
    setupDraggablePoint(point) {
        let isConnecting = false;
        let startX, startY;
        const startConnection = (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            isConnecting = true;
            const rect = point.getBoundingClientRect();
            startX = rect.left + rect.width / 2;
            startY = rect.top + rect.height / 2;
            document.dispatchEvent(new CustomEvent('connectionStart', {
                detail: {
                    node: this,
                    point: point,
                    type: point.dataset.type,
                    x: startX,
                    y: startY
                }
            }));
            document.addEventListener('mousemove', moveConnection);
            document.addEventListener('mouseup', endConnection);
        };
        const moveConnection = (e) => {
            if (!isConnecting) return;
            e.preventDefault();
            document.dispatchEvent(new CustomEvent('connectionMove', {
                detail: {
                    x: e.clientX,
                    y: e.clientY
                }
            }));
        };
        point.addEventListener('mouseenter', () => {
            point.classList.add('hover');
            const type = point.dataset.type;
            const tooltip = document.createElement('div');
            tooltip.className = 'attribute-tooltip';
            tooltip.textContent = `${type} connection point`;
            point.appendChild(tooltip);
        });
        point.addEventListener('mouseleave', () => {
            point.classList.remove('hover');
            const tooltip = point.querySelector('.attribute-tooltip');
            if (tooltip) tooltip.remove();
        });
        point.addEventListener('mousedown', () => {
            point.classList.add('dragging');
        });
        document.addEventListener('mouseup', () => {
            point.classList.remove('dragging');
        });
        const endConnection = (e) => {
            if (!isConnecting) return;
            e.preventDefault();
            isConnecting = false;
            document.removeEventListener('mousemove', moveConnection);
            document.removeEventListener('mouseup', endConnection);
        };
        point.addEventListener('mousedown', startConnection);
    }
    enableGeneration() {
        console.log('Enabling generation for node', this.id);
        if (this.isEmptyFrame && this.connectedFeatures.size >= 2) {
            this.isGenerationEnabled = true;
            const generateBtn = this.element.querySelector('.generate-btn');
            if (generateBtn) {
                generateBtn.style.display = 'block';
                generateBtn.disabled = false;
                generateBtn.addEventListener('click', () => this.handleGenerate());
            }
            this.updateGenerationStatus();
        }
    }
    updateOrCreateInheritedAttribute(type, features, weight) {
        const attributesList = this.element.querySelector('.attributes-list');
        if (!attributesList) return;
        let attributeItem = attributesList.querySelector(`.inherited-attribute[data-type="${type}"]`);
        if (!attributeItem) {
            attributeItem = this.createInheritedAttributeItem(type, features, weight);
            attributesList.appendChild(attributeItem);
        } else {
            this.updateInheritedAttributeItem(attributeItem, features, weight);
        }
    }
    createInheritedAttributeItem(type, features, weight) {
        try {
            const item = document.createElement('div');
            item.className = `attribute-item inherited ${type}`;
            item.dataset.type = type;
            const header = document.createElement('div');
            header.className = 'attribute-header';
            const labelContainer = document.createElement('div');
            labelContainer.className = 'label-container';
            const typeLabel = document.createElement('span');
            typeLabel.className = 'attribute-label';
            typeLabel.textContent = type.charAt(0).toUpperCase() + type.slice(1);
            const weightLabel = document.createElement('div');
            weightLabel.className = 'confidence-score';
            weightLabel.textContent = `${Math.round(weight * 100)}%`;
            const point = document.createElement('div');
            point.className = 'attribute-point';
            point.dataset.type = type;
            point.dataset.role = 'output';
            labelContainer.appendChild(typeLabel);
            header.appendChild(labelContainer);
            header.appendChild(weightLabel);
            header.appendChild(point);
            const featuresContainer = document.createElement('div');
            featuresContainer.className = 'detected-features';
            Object.entries(features)
                .sort(([, a], [, b]) => b - a)
                .forEach(([feature, value]) => {
                    const tag = document.createElement('span');
                    tag.className = 'feature-tag';
                    tag.textContent = feature;
                    tag.style.opacity = 0.3 + (value * 0.7);
                    featuresContainer.appendChild(tag);
                });
            item.appendChild(header);
            item.appendChild(featuresContainer);
            item.style.setProperty('--feature-base-rgb', this.getFeatureBaseRGB(type));
            item.style.setProperty('--feature-base', `var(--feature-${type}-base)`);
            if (this.isAttributesFolded) {
                point.style.opacity = '0';
                point.style.visibility = 'hidden';
            }
            return item;
        } catch (error) {
            console.error('Error creating inherited attribute item:', error);
            return null;
        }
    }
    _getGroupForType(type) {
        const groups = {
            appearance: ['color', 'style', 'object'],
            composition: ['composition', 'perspective', 'detail'],
            atmosphere: ['lighting', 'mood', 'texture']
        };
        for (const [groupName, types] of Object.entries(groups)) {
            if (types.includes(type)) {
                return groupName;
            }
        }
        return null;
    }
    getFeatureBaseRGB(type) {
        const rgbMap = {
            color: '33, 150, 243',
            style: '156, 39, 176',
            composition: '76, 175, 80',
            lighting: '255, 193, 7',
            mood: '255, 87, 34',
            object: '121, 85, 72',
            perspective: '96, 125, 139',
            detail: '255, 152, 0',
            texture: '158, 158, 158'
        };
        return rgbMap[type] || '158, 158, 158';
    }
    updateConnectedFeaturesDisplay() {
        console.log('Updating connected features display');
        const placeholder = this.element.querySelector('.attributes-placeholder');
        if (placeholder) {
            placeholder.style.display =
                this.connectedFeatures.size > 0 ? 'none' : 'block';
            if (this.connectedFeatures.size < 2) {
                placeholder.textContent =
                    `Connect ${2 - this.connectedFeatures.size} more attribute${
                        this.connectedFeatures.size === 1 ? '' : 's'
                    } to generate`;
            }
        }
        this.updateGenerationStatus();
    }
    updateInheritedAttributeItem(item, features, weight) {
        const confidenceScore = item.querySelector('.confidence-score');
        if (confidenceScore) {
            confidenceScore.textContent = `${Math.round(weight * 100)}%`;
        }
        const featuresContainer = item.querySelector('.detected-features');
        if (featuresContainer) {
            featuresContainer.innerHTML = Object.entries(features)
                .sort(([,a], [,b]) => b - a)
                .map(([feature, value]) => `
                    <span class="feature-tag" style="opacity: ${0.3 + (value * 0.7)}">
                        ${feature}
                    </span>
                `).join('');
        }
    }
    updatePlaceholder() {
        const placeholder = this.element.querySelector('.attributes-placeholder');
        if (placeholder) {
            placeholder.style.display = this.connectedFeatures.size > 0 ? 'none' : 'block';
        }
    }
    updateInheritedFeatures(type, connectionData) {
        try {
            if (!this.inheritedFeatures) {
                this.inheritedFeatures = new Map();
            }
            if (!this.inheritedFeatures.has(type)) {
                this.inheritedFeatures.set(type, []);
            }
            const typeFeatures = this.inheritedFeatures.get(type);
            const existingIndex = typeFeatures.findIndex(
                data => data.sourceNode === connectionData.sourceNode
            );
            const featureData = {
                sourceNode: connectionData.sourceNode,
                connection: connectionData.connection,
                features: connectionData.features || {},
                weight: connectionData.connection?.value || 0.5
            };
            if (existingIndex !== -1) {
                typeFeatures[existingIndex] = featureData;
            } else {
                typeFeatures.push(featureData);
            }
            const attributesList = this.element.querySelector('.attributes-list');
            if (!attributesList) return;
            let group = attributesList.querySelector(`.attribute-group[data-type="${type}"]`);
            if (!group) {
                group = document.createElement('div');
                group.className = 'attribute-group';
                group.dataset.type = type;
                attributesList.appendChild(group);
            }
            group.innerHTML = '';
            typeFeatures.forEach(data => {
                const item = this.createInheritedAttributeItem(
                    type,
                    data.features,
                    data.weight,
                    data.sourceNode.id
                );
                if (item) {
                    group.appendChild(item);
                }
            });
            this.dispatchEvent('inheritedFeaturesUpdated', {
                type,
                features: typeFeatures
            });
        } catch (error) {
            console.error('Error updating inherited features:', error);
        }
    }
    handleConnectionDestroyed(e) {
        const connection = e.detail.connection;
        if (connection.targetNode === this) {
            const type = connection.type;
            this.connectedFeatures.delete(type);
            this.updateGenerationStatus();
            this.updateAttributeState(type);
        }
    }
    updateAttributeState(type) {
        try {
            const attributeItem = this.element.querySelector(`.attribute-item[data-type="${type}"]`);
            if (!attributeItem) return;
            const data = this.connectedFeatures.get(type);
            if (!data) return;
            attributeItem.classList.toggle('connected', true);
            const confidenceScore = attributeItem.querySelector('.confidence-score');
            if (confidenceScore) {
                confidenceScore.textContent = `${Math.round(data.weight * 100)}%`;
            }
            if (data.features) {
                const featureTags = attributeItem.querySelector('.detected-features');
                if (featureTags) {
                    featureTags.style.opacity = 0.3 + (data.weight * 0.7);
                }
            }
        } catch (error) {
            console.error('Error updating attribute state:', error);
        }
    }
    handleFeatureUpdate(event) {
        try {
            const { connection, type, value } = event.detail;
            if (!connection || !type) return;
            this.connectedFeatures.forEach((connections, featureType) => {
                connections.forEach(data => {
                    if (data.connection === connection) {
                        data.weight = value;
                        if (connection.setValue) {
                            connection.setValue(value);
                        }
                    }
                });
            });
            if (this.isEmptyFrame) {
                this.updateGenerationStatus();
            }
            this.dispatchEvent('featureUpdated', {
                type,
                connection,
                value
            });
        } catch (error) {
            console.error('Error handling feature update:', error);
        }
    }
    updateFeatureDisplay(type) {
        const attributeItem = this.element.querySelector(`.attribute-item[data-category="${type}"]`);
        if (!attributeItem) return;
        const featureData = this.connectedFeatures.get(type);
        if (!featureData) return;
        const featureTags = attributeItem.querySelector('.detected-features');
        if (featureTags) {
            featureTags.style.opacity = featureData.weight;
        }
    }
    updateAttributeState(type, weight) {
        const attributeItem = this.element.querySelector(`.attribute-item[data-type="${type}"]`);
        if (!attributeItem) return;
        attributeItem.classList.toggle('inherited', true);
        attributeItem.style.setProperty('--inheritance-strength', weight);
        const confidenceScore = attributeItem.querySelector('.confidence-score');
        if (confidenceScore) {
            confidenceScore.textContent = `${Math.round(weight * 100)}%`;
        }
        const featureTags = attributeItem.querySelector('.detected-features');
        if (featureTags) {
            featureTags.style.opacity = 0.3 + (weight * 0.7);
        }
    }
    updateGenerationStatus() {
        if (!this.isEmptyFrame || !this.element) return;

        try {
            const attributesList = this.element.querySelector('.attributes-list');
            if (!attributesList) return;
            attributesList.innerHTML = '';
            const processedTypes = new Set();
            const groupedConnections = new Map();
            this.connectedFeatures.forEach((connections, type) => {
                if (processedTypes.has(type)) return;

                const validConnections = connections.filter(data =>
                    data.connection?.targetNode === this &&
                    data.sourceNode?.featureAnalysis?.features?.[type]
                );

                if (validConnections.length > 0) {
                    processedTypes.add(type);

                    const group = this._getGroupForType(type);
                    if (!groupedConnections.has(group)) {
                        groupedConnections.set(group, []);
                    }

                    validConnections.forEach(connData => {
                        groupedConnections.get(group).push({
                            type,
                            data: connData,
                            features: connData.sourceNode.featureAnalysis.features[type]
                        });
                    });
                }
            });

            const groups = {
                appearance: ['color', 'style', 'object'],
                composition: ['composition', 'perspective', 'detail'],
                atmosphere: ['lighting', 'mood', 'texture']
            };

            for (const [groupName, typeArr] of Object.entries(groups)) {
                const groupItems = groupedConnections.get(groupName) || [];

                if (groupItems.length > 0) {
                    const group = document.createElement('div');
                    group.className = 'attribute-group';
                    group.dataset.group = groupName;

                    const header = document.createElement('div');
                    header.className = 'group-header';
                    header.innerHTML = `
                        <span>${groupName.charAt(0).toUpperCase() + groupName.slice(1)}</span>
                        <span class="group-toggle">▼</span>
                    `;
                    group.appendChild(header);

                    const content = document.createElement('div');
                    content.className = 'group-content';
                    group.appendChild(content);

                    if (this.foldedGroups && this.foldedGroups.has(groupName)) {
                        group.classList.add('collapsed');
                        const toggle = header.querySelector('.group-toggle');
                        if (toggle) toggle.textContent = '▶';
                        Object.assign(content.style, {
                            height: '0',
                            opacity: '0',
                            overflow: 'hidden'
                        });
                    }


                    groupItems.forEach(itemInfo => {
                        const { type, data, features } = itemInfo;
                        const weight = data.weight || 0.5;

                        const item = this.createInheritedAttributeItem(type, features, weight);
                        if (item) {
                            content.appendChild(item);
                        }
                    });

                    attributesList.appendChild(group);
                }
            }

            const generateBtn = this.element.querySelector('.generate-btn');
            if (generateBtn) {
                let validTypesCount = 0;
                this.connectedFeatures.forEach((connections, type) => {
                    const validConns = connections.filter(d =>
                        d.connection?.targetNode === this &&
                        d.sourceNode?.featureAnalysis?.features?.[type]
                    );
                    if (validConns.length > 0) {
                        validTypesCount++;
                    }
                });

                const canGenerate = (validTypesCount >= 2);
                generateBtn.style.display = canGenerate ? 'block' : 'none';
                generateBtn.disabled = !canGenerate || this.isGenerating;
            }

        } catch (error) {
            console.error('Error in updateGenerationStatus:', error);
        }
    }
    setAnalysisStatus(message, isError = false) {
        const content = this.element.querySelector('.attributes-content');
        if (!content) return;
        let statusElement = content.querySelector('.analyzing-indicator');
        if (!statusElement && message) {
            statusElement = document.createElement('div');
            statusElement.className = 'analyzing-indicator';
            content.insertBefore(statusElement, content.firstChild);
        }
        if (statusElement) {
            if (message) {
                statusElement.textContent = message;
                statusElement.className = `analyzing-indicator${isError ? ' error' : ''}`;
            } else {
                statusElement.remove();
            }
        }
    }
    setPosition(x, y, suppressEvents = false) {
        if (!this.element || !this.element.parentElement) {
            console.warn('Cannot set position: element or parent not found');
            return;
        }
        try {
            const canvas = this.element.parentElement;
            const canvasRect = canvas.getBoundingClientRect();
            const nodeRect = this.element.getBoundingClientRect();
            const minX = -nodeRect.width / 2;
            const maxX = canvasRect.width - nodeRect.width / 2;
            const minY = 0;
            const maxY = canvasRect.height - nodeRect.height / 2;
            const boundedX = Math.max(minX, Math.min(maxX, x));
            const boundedY = Math.max(minY, Math.min(maxY, y));
            this.position = { x: boundedX, y: boundedY };
            this.element.style.transform = `translate(${boundedX}px, ${boundedY}px)`;
            this._positionCache = { ...this.position };
            if (!suppressEvents) {
                this.dispatchNodeMoved();
            }
            requestAnimationFrame(() => {
                this.updateConnections();
            });
        } catch (error) {
            console.error('Error setting position:', error);
            throw error;
        }
    }
    dispatchNodeMoved() {
        this.dispatchEvent('nodeMoved', {
            position: this.position
        });
    }
    dispatchEvent(eventName, detail = {}) {
        if (!this.element) return;
        detail.node = this;
        this.element.dispatchEvent(new CustomEvent(eventName, {
            bubbles: true,
            detail
        }));
    }
    destroy() {
        if (this.isDestroyed) return;
        try {
            if (this._boundHandlers) {
                for (const [eventName, handler] of Object.entries(this._boundHandlers)) {
                    document.removeEventListener(eventName, handler);
                }
                this._boundHandlers = null;
            }
            this.foldedGroups.clear();
            this.isAttributesFolded = false;
            if (this.connectedFeatures) {
                this.connectedFeatures.forEach((connections, type) => {
                    connections.forEach(data => {
                        if (data.connection) {
                            if (data.connection.element) {
                                data.connection.element.classList.remove('using-main-point');
                                data.connection.element.style.opacity = '0';
                                data.connection.element.style.pointerEvents = 'none';
                            }
                            setTimeout(() => {
                                if (!data.connection.isDestroyed) {
                                    data.connection.destroy();
                                }
                            }, 300);
                        }
                    });
                });
            }
            this.connectedFeatures.clear();
            if (this.element) {
                this.element.style.transition = 'opacity 0.3s ease';
                this.element.style.opacity = '0';
                this.element.style.pointerEvents = 'none';
                setTimeout(() => {
                    if (this.element && this.element.parentNode) {
                        this.element.parentNode.removeChild(this.element);
                    }
                    this.element = null;
                }, 300);
            }
            this.isDestroyed = true;
            this.dispatchEvent('nodeDestroyed', { node: this });
        } catch (error) {
            console.error('Error destroying node:', error);
            this.element = null;
            this.connectedFeatures = new Map();
            this.isDestroyed = true;
        }
    }
    select() {
        if (!this.selected) {
            this.selected = true;
            this.element.classList.add('selected');
        }
    }
    deselect() {
        if (this.selected) {
            this.selected = false;
            this.element.classList.remove('selected');
        }
    }
    async generateImage() {
        if (!this.canGenerate()) {
            console.warn('Cannot generate: insufficient connections');
            return;
        }
        try {
            this.isGenerating = true;
            this.updateGenerationStatus();
            const features = {};
            this.connectedFeatures.forEach((data, type) => {
                if (!data.sourceNode?.featureAnalysis?.features) return;
                features[type] = {
                    sourcePrompt: data.sourceNode.prompt,
                    weight: data.weight,
                    features: data.sourceNode.featureAnalysis.features[type] || {},
                    analysis: data.sourceNode.featureAnalysis
                };
            });
            console.log("Features for interpolation:", features);
            const response = await fetch('/api/interpolate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    features,
                    model,
                    size,
                    quality
                })
            });
            if (!response.ok) {
                throw new Error(`Server error: ${response.status}`);
            }
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || 'Generation failed');
            }
            this.prompt = result.prompt;
            await this.convertToImageNode(
                result.url,
                result.prompt,
                result.analysis
            );
            this.featureAnalysis = result.analysis;
            await this.updateAttributesDisplay();
        } catch (error) {
            console.error('Generate image error:', error);
            this.showError(`Failed to generate image: ${error.message}`);
        } finally {
            this.isGenerating = false;
            this.updateGenerationStatus();
        }
    }

    async convertToImageNode(imageUrl, prompt, analysis) {
    console.log('🚀 Converting node to image node:', this.id);
    console.log('📊 [convertToImageNode] Input analysis:', {
        hasAnalysis: !!analysis,
        analysisType: typeof analysis,
        analysisKeys: analysis ? Object.keys(analysis) : [],
        isArray: Array.isArray(analysis)
    });

    const savedPosition = { ...this.position };
    const savedConnections = new Map(this.connectedFeatures);
    const savedElement = this.element;
    const savedIsAttributesFolded = this.isAttributesFolded;

    console.log('💾 [convertToImageNode] Saved state:', {
        position: savedPosition,
        connectionsCount: savedConnections.size,
        hasElement: !!savedElement,
        hasParent: !!savedElement?.parentNode,
        isFolded: savedIsAttributesFolded
    });

    try {
        this.imageUrl = imageUrl;
        this.prompt = prompt;
        this.isEmptyFrame = false;
        this.featureAnalysis = analysis;

        console.log('📋 [convertToImageNode] FeatureAnalysis set:', {
            hasFeatureAnalysis: !!this.featureAnalysis,
            featureKeys: this.featureAnalysis ? Object.keys(this.featureAnalysis) : []
        });

        console.log('🔧 [convertToImageNode] Creating new element...');
        const newElement = this.createElement();
        if (!newElement) {
            throw new Error('Failed to create new element');
        }

        console.log('✅ [convertToImageNode] New element created:', {
            hasElement: !!newElement,
            className: newElement.className,
            childrenCount: newElement.children.length
        });

        if (imageUrl && (imageUrl.startsWith('http') || imageUrl.startsWith('data:image'))) {
            console.log('🖼️ [convertToImageNode] Waiting for image to load...');
            await new Promise(resolve => {
                const img = newElement.querySelector('img');
                if (img) {
                    const timeout = setTimeout(() => {
                        console.log('⏰ [convertToImageNode] Image load timeout');
                        resolve();
                    }, 3000); // 3秒超时

                    img.onload = () => {
                        console.log('✅ [convertToImageNode] Image loaded successfully');
                        clearTimeout(timeout);
                        resolve();
                    };
                    img.onerror = (error) => {
                        console.log('❌ [convertToImageNode] Image load error:', error);
                        clearTimeout(timeout);
                        resolve();
                    };
                } else {
                    console.log('⚠️ [convertToImageNode] No img element found, resolving immediately');
                    resolve();
                }
            });
        }

        console.log('🔄 [convertToImageNode] Replacing DOM element...');
        if (savedElement?.parentNode) {
            savedElement.parentNode.replaceChild(newElement, savedElement);
            console.log('✅ [convertToImageNode] DOM element replaced successfully');
        } else {
            console.error('❌ [convertToImageNode] No parent node for replacement!');
            throw new Error('No parent node found');
        }

        this.element = newElement;

        this.isAttributesFolded = savedIsAttributesFolded;
        this.setPosition(savedPosition.x, savedPosition.y, true);

        console.log('📍 [convertToImageNode] Position and state restored:', {
            position: savedPosition,
            isFolded: this.isAttributesFolded
        });

        this.element.style.display = '';
        this.element.style.visibility = 'visible';
        this.element.style.opacity = '1';
        this.element.style.pointerEvents = 'auto';

        console.log('👁️ [convertToImageNode] Ensured node visibility');

        console.log('🎧 [convertToImageNode] Setting up event listeners...');
        this.setupEventListeners();
        this.setupDragging();

        await new Promise(requestAnimationFrame);
        console.log('🎨 [convertToImageNode] Browser render frame completed');

        console.log('🔗 [convertToImageNode] Restoring connections...');
        this.connectedFeatures.clear();

        let restoredConnectionsCount = 0;
        for (const [type, dataArray] of savedConnections.entries()) {
            if (!Array.isArray(dataArray)) continue;

            console.log(`🔗 [convertToImageNode] Restoring connections for type: ${type}`, {
                connectionsCount: dataArray.length
            });

            for (const data of dataArray) {
                const connection = data.connection;
                if (!connection || connection.isDestroyed) {
                    console.log(`⚠️ [convertToImageNode] Skipping destroyed connection for type ${type}`);
                    continue;
                }

                console.log(`🔗 [convertToImageNode] Processing connection for type ${type}:`, {
                    connectionId: connection.id,
                    isTargetNode: connection.targetNode === this,
                    isSourceNode: connection.sourceNode === this
                });

                if (connection.targetNode === this) {
                    const newTargetPoint = this.element.querySelector(`.attribute-point[data-type="${type}"]`) ||
                                         this.element.querySelector('.attributes-input-point');
                    if (newTargetPoint) {
                        connection.targetPoint = newTargetPoint;
                        console.log(`✅ [convertToImageNode] Updated target point for ${type}`);
                    } else {
                        console.error(`❌ [convertToImageNode] Failed to find target point for ${type}`);
                    }
                }

                if (connection.sourceNode === this) {
                    const newSourcePoint = this.element.querySelector(`.attribute-point[data-type="${type}"]`) ||
                                         this.element.querySelector('.attributes-output-point');
                    if (newSourcePoint) {
                        connection.sourcePoint = newSourcePoint;
                        console.log(`✅ [convertToImageNode] Updated source point for ${type}`);
                    } else {
                        console.error(`❌ [convertToImageNode] Failed to find source point for ${type}`);
                    }
                }

                if (!this.connectedFeatures.has(type)) {
                    this.connectedFeatures.set(type, []);
                }
                this.connectedFeatures.get(type).push(data);
                restoredConnectionsCount++;
            }
        }

        console.log(`🔗 [convertToImageNode] Restored ${restoredConnectionsCount} connections`);

        await new Promise(requestAnimationFrame);
        console.log('🔄 [convertToImageNode] Updating connection positions...');

        let updatedPositionsCount = 0;
        this.connectedFeatures.forEach(dataArray => {
            dataArray.forEach(data => {
                if (data.connection && !data.connection.isDestroyed) {
                    try {
                        data.connection.updatePosition();
                        updatedPositionsCount++;
                    } catch (error) {
                        console.error('❌ [convertToImageNode] Error updating connection position:', error);
                    }
                }
            });
        });

        console.log(`✅ [convertToImageNode] Updated ${updatedPositionsCount} connection positions`);

        if (this.isAttributesFolded) {
            this.updateConnectionsVisibility?.();
            console.log('🔄 [convertToImageNode] Updated connections visibility for folded state');
        }

        await this.updateAttributesDisplay();
        console.log('🎨 [convertToImageNode] Attributes display updated');

        console.log('🔧 Rebuilding node interaction state...');

        await new Promise(requestAnimationFrame);
        this.setupAttributePoints();

        const attributePoints = this.element.querySelectorAll('.attribute-point');
        console.log(`🎯 Found ${attributePoints.length} attribute points`);

        attributePoints.forEach((point, index) => {
            const type = point.dataset.type;
            console.log(`🔗 Setting up attribute point ${index}: ${type}`);

            point.style.visibility = 'visible';
            point.style.opacity = '1';
            point.style.pointerEvents = 'auto';
            point.classList.remove('hidden');
            point.classList.add('connectable');

            this.setupDraggablePoint?.(point);
        });

        if (!this.featureAnalysis || !this.featureAnalysis.features) {
            console.log('⚠️ Feature analysis missing, reconstructing...');
            if (analysis) {
                if (analysis.features) {
                    this.featureAnalysis = analysis;
                } else {
                    this.featureAnalysis = { features: analysis };
                }
            }
        }

        setTimeout(() => {
            this.dispatchEvent?.('nodeReadyForConnections', {
                nodeId: this.id,
                hasFeatures: !!this.featureAnalysis?.features,
                featureCount: this.featureAnalysis?.features ? Object.keys(this.featureAnalysis.features).length : 0
            });

            console.log('📡 Node ready event dispatched');
        }, 200);

        console.log('✅ Final node state verification:', {
            nodeId: this.id,
            hasElement: !!this.element,
            hasFeatureAnalysis: !!this.featureAnalysis,
            featureKeys: this.featureAnalysis?.features ? Object.keys(this.featureAnalysis.features) : [],
            attributePointsCount: this.element.querySelectorAll('.attribute-point').length,
            isVisible: this.element.style.display !== 'none',
            connectedFeaturesSize: this.connectedFeatures.size
        });

        console.log('🎉 Node conversion completed successfully!');

    } catch (error) {
        console.error('💥 [convertToImageNode] Conversion failed:', error);

        console.log('🔄 [convertToImageNode] Attempting rollback...');
        try {
            if (savedElement && this.element?.parentNode) {
                this.element.parentNode.replaceChild(savedElement, this.element);
            }
            this.element = savedElement;
            this.position = savedPosition;
            this.connectedFeatures = savedConnections;
            this.isAttributesFolded = savedIsAttributesFolded;
            console.log('✅ [convertToImageNode] Rollback completed');
        } catch (rollbackError) {
            console.error('❌ [convertToImageNode] Rollback failed:', rollbackError);
        }

        throw error;
    }
}
    ensurePromptSection() {
        const sectionsContainer = this.element.querySelector('.sections-container');
        if (!sectionsContainer || !this.prompt) return;
        const existingPromptSection = sectionsContainer.querySelector('.prompt-section');
        if (!existingPromptSection) {
            const promptSection = document.createElement('div');
            promptSection.className = 'section prompt-section';
            promptSection.innerHTML = `
                <div class="section-header">
                    <span class="section-title">Prompt</span>
                    <button class="section-toggle" aria-label="Toggle prompt">▼</button>
                </div>
                <div class="section-content prompt-content">
                    ${this.prompt}
                </div>
            `;
            sectionsContainer.appendChild(promptSection);
        }
    }
    restoreConnections(savedConnections) {
        try {
            this.connectedFeatures.clear();
            savedConnections.forEach((connections, type) => {
                if (!this.connectedFeatures.has(type)) {
                    this.connectedFeatures.set(type, []);
                }
                connections.forEach(data => {
                    if (!data.sourceNode || !data.connection) return;
                    const attributePoint = this.element.querySelector(
                        `.attribute-point[data-type="${type}"]`
                    );
                    if (!attributePoint) return;
                    const connection = new Connection(
                        data.sourceNode,
                        this,
                        type,
                        data.connection.sourcePoint,
                        attributePoint
                    );
                    connection.setValue(data.weight || 0.5);
                    this.connectedFeatures.get(type).push({
                        connection,
                        sourceNode: data.sourceNode,
                        weight: data.weight || 0.5,
                        features: data.features || {}
                    });
                });
            });
            this.updateConnectionsVisibility();
        } catch (error) {
            console.error('Error restoring connections:', error);
        }
    }
    _cleanPrompt(prompt) {
        if (!prompt) return '';
        return prompt
            .replace(/Create an image combining these features:.*?Original elements from:\s*/s, '')
            .replace(/\s*Original elements from:.*$/, '')
            .trim();
    }
    toggleAttributes() {
        const section = this.element.querySelector('.attributes-section');
        if (!section) return;
        const content = section.querySelector('.section-content');
        const header = section.querySelector('.section-header');
        const toggle = header.querySelector('.section-toggle');
        this.isAttributesExpanded = !this.isAttributesExpanded;
        section.classList.toggle('expanded', this.isAttributesExpanded);
        if (toggle) {
            toggle.textContent = this.isAttributesExpanded ? '▼' : '▲';
        }
        this.updateConnections();
        this.dispatchEvent('attributesToggled', {
            expanded: this.isAttributesExpanded
        });
    }
    updateImage(url, prompt, analysis = null) {
        try {
            const savedConnections = new Map();
            for (const [type, connections] of this.connectedFeatures.entries()) {
                savedConnections.set(type, connections.map(data => ({
                    ...data,
                    connection: data.connection,
                    sourceNode: data.sourceNode,
                    targetNode: data.targetNode,
                    weight: data.weight,
                    features: { ...data.features }
                })));
            }
            this.imageUrl = url;
            this.prompt = prompt;
            const oldElement = this.element;
            this.element = this.createElement();
            if (oldElement && oldElement.parentNode) {
                oldElement.parentNode.replaceChild(this.element, oldElement);
            }
            this.connectedFeatures = new Map();
            for (const [type, connections] of savedConnections.entries()) {
                this.connectedFeatures.set(type, []);
                for (const data of connections) {
                    if (data.connection) {
                        const attributePoint = this.isAttributesFolded ?
                            this.element.querySelector('.attributes-input-point') :
                            this.element.querySelector(`.attribute-point[data-type="${type}"]`);
                        if (attributePoint) {
                            data.connection.targetPoint = attributePoint;
                            this.connectedFeatures.get(type).push({
                                connection: data.connection,
                                sourceNode: data.sourceNode,
                                targetNode: this,
                                weight: data.weight,
                                features: data.features
                            });
                            if (this.isAttributesFolded) {
                                data.connection.element.classList.add('using-main-point');
                                if (data.connection.pathElement) {
                                    Object.assign(data.connection.pathElement.style, {
                                        strokeDasharray: '4,4',
                                        // strokeWidth: '2px',
                                        opacity: '0.8',
                                        transition: 'all 0.3s ease'
                                    });
                                }
                            }
                        }
                    }
                }
            }
            if (analysis) {
                this.featureAnalysis = analysis;
                this.updateAttributesDisplay();
            }
            requestAnimationFrame(() => {
                this.connectedFeatures.forEach(connections => {
                    connections.forEach(data => {
                        if (data.connection && !data.connection.isDestroyed) {
                            data.connection.updatePosition();
                        }
                    });
                });
            });
            this.dispatchEvent('nodeUpdated', {
                url,
                prompt,
                analysis
            });
        } catch (error) {
            console.error('Error updating image:', error);
            throw error;
        }
    }
    findConnectionBySource(type) {
        const connections = Array.from(this.connectedFeatures.values());
        return connections.find(conn => conn.type === type);
    }
    validateNodeState() {
        if (!this.element) return false;
        if (this.isDestroyed) return false;
        return true;
    }
    cleanup() {
        this.connectedFeatures.forEach((data, type) => {
            if (data.connection) {
                data.connection.destroy();
            }
        });
        this.removeEventListeners();
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
        this.isDestroyed = true;
    }
    handleError(error, context) {
        console.error(`Error in ${context}:`, error);
        this.isProcessing = false;
        this.isGenerating = false;
        const message = error.message || 'An unexpected error occurred';
        this.dispatchEvent('nodeError', {
            error: error,
            context: context,
            message: message
        });
        this.tryRecover(context);
        this.dispatchEvent('nodeError', { error });
        this.updateButtonStates();
    }
    tryRecover() {
        this.isProcessing = false;
        this.isGenerating = false;
        if (this.element) {
            this.element.style.pointerEvents = 'auto';
            this.element.classList.remove('processing', 'generating');
            const controls = this.element.querySelectorAll('button, input, .attribute-point');
            controls.forEach(control => {
                control.disabled = false;
                control.style.pointerEvents = 'auto';
            });
            const attributesSection = this.element.querySelector('.attributes-section');
            if (attributesSection) {
                attributesSection.style.pointerEvents = 'auto';
            }
        }
    }
    updateConnections() {
        if (this.isDestroyed) return;
        try {
            this.connectedFeatures.forEach((data, type) => {
                const connection = data.connection;
                if (!connection) return;
                if (this === connection.targetNode) {
                    const mainInput = this.element.querySelector('.attributes-input-point');
                    if (mainInput && connection.targetPoint !== mainInput) {
                        connection.targetPoint = mainInput;
                    }
                } else if (this === connection.sourceNode) {
                    if (this.isAttributesFolded) {
                        const mainOutput = this.element.querySelector('.attributes-output-point');
                        if (mainOutput) {
                            connection.sourcePoint = mainOutput;
                        }
                    } else {
                        const attributePoint = this.element.querySelector(
                            `.attribute-point[data-type="${type}"]`
                        );
                        if (attributePoint) {
                            connection.sourcePoint = attributePoint;
                        }
                    }
                }
                connection.updatePosition();
                connection.updateVisuals();
            });
        } catch (error) {
            console.error('Error updating connections:', error);
        }
    }
    updatePosition() {
        if (!this.element || !this.element.parentElement || this.isDestroyed) return;
        try {
            const shouldUseMainOutput = this.element.classList.contains('using-main-point');
            let sourcePoint = this.sourcePoint;
            let targetPoint = this.targetPoint;
            if (shouldUseMainOutput && this.sourceNode) {
                const mainOutput = this.sourceNode.element.querySelector('.attributes-output-point');
                if (mainOutput) {
                    if (!this._originalSourcePoint && sourcePoint !== mainOutput) {
                        this._originalSourcePoint = sourcePoint;
                    }
                    sourcePoint = mainOutput;
                    this.sourcePoint = mainOutput;
                    sourcePoint = this._originalSourcePoint ? mainOutput : sourcePoint;
                    Object.assign(mainOutput.style, {
                        position: 'absolute',
                        right: '8px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        opacity: '1',
                        visibility: 'visible',
                        pointerEvents: 'auto',
                        zIndex: '1000'
                    });
                    mainOutput.classList.add('active');
                }
            }
            if (!sourcePoint || !targetPoint) {
                console.warn('Missing connection points');
                return;
            }
            const canvasRect = this.element.parentElement.getBoundingClientRect();
            const sourceRect = sourcePoint.getBoundingClientRect();
            const targetRect = targetPoint.getBoundingClientRect();
            const sourcePos = {
                x: sourceRect.left + sourceRect.width/2 - canvasRect.left,
                y: sourceRect.top + sourceRect.height/2 - canvasRect.top
            };
            const targetPos = {
                x: targetRect.left + targetRect.width/2 - canvasRect.left,
                y: targetRect.top + targetRect.height/2 - canvasRect.top
            };
            if (!this.validatePositions(sourcePos, targetPos)) {
                if (this._lastValidPath) {
                    this.pathElement?.setAttribute('d', this._lastValidPath);
                }
                return;
            }
            const path = this.calculatePath(sourcePos, targetPos);
            if (this.pathElement) {
                this.pathElement.setAttribute('d', path);
                if (shouldUseMainOutput) {
                    Object.assign(this.pathElement.style, {
                        strokeDasharray: '4,4',
                        // strokeWidth: '2px',
                        opacity: '0.8',
                        transition: 'all 0.3s ease'
                    });
                } else {
                    Object.assign(this.pathElement.style, {
                        strokeDasharray: 'none',
                        // strokeWidth: '2px',
                        opacity: '1',
                        transition: 'all 0.3s ease'
                    });
                }
            }
            if (this.hitArea) {
                this.hitArea.setAttribute('d', path);
            }
            this.updateGradientDirection(sourcePos, targetPos);
            this._lastValidPath = path;
            if (this.isControlVisible && this.sliderContainer) {
                this.updateControlPosition(sourcePos, targetPos);
            }
        } catch (error) {
            console.error('Connection update error:', error);
            if (this._lastValidPath && this.pathElement) {
                this.pathElement.setAttribute('d', this._lastValidPath);
            }
        }
    }
    calculatePath(source, target) {
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const curvature = Math.min(0.3, 100 / distance);
        const controlPoint1 = {
            x: source.x + dx * curvature,
            y: source.y + dy * 0.2
        };
        const controlPoint2 = {
            x: target.x - dx * curvature,
            y: target.y - dy * 0.2
        };
        return `M ${source.x},${source.y}
                C ${controlPoint1.x},${controlPoint1.y}
                  ${controlPoint2.x},${controlPoint2.y}
                  ${target.x},${target.y}`;
    }
    updateGradientDirection(sourcePos, targetPos) {
        if (!this.gradientElement) return;
        const gradient = this.gradientElement;
        gradient.setAttribute('x1', sourcePos.x);
        gradient.setAttribute('y1', sourcePos.y);
        gradient.setAttribute('x2', targetPos.x);
        gradient.setAttribute('y2', targetPos.y);
    }
    getPointPosition(point, canvasRect) {
        if (!point || !point.getBoundingClientRect) {
            return null;
        }
        try {
            const rect = point.getBoundingClientRect();
            return {
                x: rect.left + rect.width / 2 - canvasRect.left,
                y: rect.top + rect.height / 2 - canvasRect.top
            };
        } catch (error) {
            console.error('Error getting point position:', error);
            return null;
        }
    }
    isPositionValid() {
        if (!this.element || this.isDestroyed) return false;
        const rect = this.element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 &&
               !isNaN(rect.x) && !isNaN(rect.y);
    }
    scheduleRetry() {
        if (this.retryCount > 0) {
            setTimeout(() => {
                this.retryCount--;
                this.updatePosition();
            }, this.retryDelay);
        } else {
            console.warn(`Failed to update connection ${this.id} after ${3 - this.retryCount} attempts`);
            this.retryCount = 3;
        }
    }
    canGenerate() {
        if (!this.isEmptyFrame || this.isDestroyed || this.isGenerating) {
            return false;
        }
        let validConnections = 0;
        this.connectedFeatures.forEach((connections, type) => {
            connections.forEach(data => {
                if (data.connection?.targetNode === this &&
                    data.sourceNode?.featureAnalysis?.features?.[type]) {
                    validConnections++;
                }
            });
        });
        return validConnections >= 2;
    }
    setLoading(loading) {
        if (loading) {
            this.element.classList.add('generating');
        } else {
            this.element.classList.remove('generating');
        }
    }
    showError(message) {
        console.error(message);
        const event = new CustomEvent('showNotification', {
            bubbles: true,
            detail: {
                message,
                type: 'error'
            }
        });
        this.element.dispatchEvent(event);
    }
}
export default Node;
