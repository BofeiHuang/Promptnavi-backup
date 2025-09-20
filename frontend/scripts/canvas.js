import Node from './node.js';
import Connection from './connection.js';
class Canvas {
    constructor(container) {
        if (!container) {
            throw new Error('Canvas container is required');
        }
        this.container = container;
        this.container.style.cursor = 'default';
        // 初始化状态
        this.nodes = [];
        this.connections = new Map();
        this.selectedNodes = [];
        this.temporaryConnection = null;
        this.history = [];
        this.historyIndex = -1;
        this.isTemporaryVisible = false;
        this.attributesExpandedState = true;
        this.renderQueue = new Set();
        this.isRenderScheduled = false;
        this.connectionGroups = new Map();
        this.handleMouseDown = this.handleMouseDown.bind(this);
        this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseUp = this.handleMouseUp.bind(this);
        this.boundHandleConnectionStart = this.handleConnectionStart.bind(this);
        this.boundHandleConnectionMove = this.handleConnectionMove.bind(this);
        this.boundHandleConnectionEnd = this.handleConnectionEnd.bind(this);
        document.addEventListener('connectionStart', this.boundHandleConnectionStart);
        document.addEventListener('connectionMove', this.boundHandleConnectionMove);
        document.addEventListener('connectionEnd', this.boundHandleConnectionEnd);
        try {
            this.validateContainer();
            this.setupEventListeners();
            this.setupContextMenu();
        } catch (error) {
            console.error('Canvas initialization failed:', error);
            throw error;
        }
    }
    handleMouseDown(e) {
        if (e.target !== this.container) return;
        try {
            console.log('[Canvas] Mouse down on container');
            this.isDragging = true;
            this.container.style.cursor = 'grabbing';
            const canvasRect = this.container.getBoundingClientRect();
            this.lastX = e.clientX - canvasRect.left;
            this.lastY = e.clientY - canvasRect.top;
            this.initialNodePositions = new Map(
                this.nodes.map(node => [node, { ...node.position }])
            );
            document.addEventListener('mousemove', this.handleMouseMove);
            document.addEventListener('mouseup', this.handleMouseUp);
            e.stopPropagation();
            e.preventDefault();
        } catch (error) {
            console.error('[Canvas] Error in mousedown handler:', error);
            this.isDragging = false;
            this.container.style.cursor = 'default';
        }
    }
    handleMouseMove(e) {
        if (!this.isDragging) return;

        try {
            const canvasRect = this.container.getBoundingClientRect();

            const currentX = e.clientX - canvasRect.left;
            const currentY = e.clientY - canvasRect.top;

            const dx = currentX - this.lastX;
            const dy = currentY - this.lastY;

            this.nodes.forEach(node => {
                const initialPos = this.initialNodePositions.get(node);
                if (!initialPos) return;

                let newX = initialPos.x + dx;
                let newY = initialPos.y + dy;

                newX = Math.max(0, Math.min(newX, this.container.offsetWidth - node.element.offsetWidth));
                newY = Math.max(0, Math.min(newY, this.container.offsetHeight - node.element.offsetHeight));


                node.setPosition(newX, newY);

                const connections = this.getNodeConnections(node);
                connections.forEach(connection => {
                    if (connection && !connection.isDestroyed) {
                        connection.updatePosition();
                    }
                });
            });

            if (this.scheduleRender) {
                this.scheduleRender();
            }

        } catch (error) {
            console.error('[Canvas] Error in mousemove handler:', error);
        }
    }
    handleMouseUp() {
        try {
            if (!this.isDragging) return;
            this.isDragging = false;
            this.container.style.cursor = 'default';
            document.removeEventListener('mousemove', this.handleMouseMove);
            document.removeEventListener('mouseup', this.handleMouseUp);
            this.initialNodePositions.clear();
            if (this.addToHistory) {
                this.addToHistory();
            }
            this.nodes.forEach(node => {
                this.dispatchEvent('nodeMoved', {
                    node: node,
                    position: node.position
                });
            });
            this.lastX = null;
            this.lastY = null;
            this.initialNodePositions = null;
            if (this.scheduleRender) {
                this.scheduleRender();
            }
        } catch (error) {
            console.error('[Canvas] Error in mouseup handler:', error);
            this.container.style.cursor = 'default';
        }
    }
    validateContainer() {
        if (!this.container.classList.contains('canvas-container')) {
            console.warn('Container missing canvas-container class');
            this.container.classList.add('canvas-container');
        }
    }
    setupDragging() {
        let isDragging = false;
        let activeNode = null;
        let startX, startY;
        let initialNodePosition;
        const startDragging = (e) => {
            if (e.target.classList.contains('attribute-point') ||
                e.target.closest('.section-header') ||
                e.target.closest('.node-header')) {
                return;
            }
            const nodeElement = e.target.closest('.node');
            if (!nodeElement) return;
            const node = this.nodes.find(n => n.element === nodeElement);
            if (!node || node.isProcessing || node.isDragging) return;
            e.preventDefault();
            e.stopPropagation();
            isDragging = true;
            activeNode = node;
            node.isDragging = true;
            nodeElement.style.zIndex = '1000';
            const canvasRect = this.container.getBoundingClientRect();
            startX = e.clientX - canvasRect.left;
            startY = e.clientY - canvasRect.top;
            initialNodePosition = { ...node.position };
            document.addEventListener('mousemove', onDrag);
            document.addEventListener('mouseup', stopDragging);
            this.dispatchEvent('dragStart', {
                node: activeNode,
                position: initialNodePosition
            });
        };
        const onDrag = (e) => {
            if (!isDragging || !activeNode) return;
            const canvasRect = this.container.getBoundingClientRect();
            const dx = (e.clientX - canvasRect.left) - startX;
            const dy = (e.clientY - canvasRect.top) - startY;
            const newX = initialNodePosition.x + dx;
            const newY = initialNodePosition.y + dy;
            activeNode.setPosition(newX, newY);
            requestAnimationFrame(() => {
                this.updateNodeConnections(activeNode);
            });
        };
        const stopDragging = () => {
            if (!isDragging || !activeNode) return;
            isDragging = false;
            activeNode.isDragging = false;
            activeNode.element.style.zIndex = '';
            document.removeEventListener('mousemove', onDrag);
            document.removeEventListener('mouseup', stopDragging);
            this.dispatchEvent('dragEnd', {
                node: activeNode,
                position: activeNode.position
            });
            activeNode = null;
        };
        if (this.container) {
            this.container.addEventListener('mousedown', startDragging);
        }
        return () => {
            if (this.container) {
                this.container.removeEventListener('mousedown', startDragging);
            }
            document.removeEventListener('mousemove', onDrag);
            document.removeEventListener('mouseup', stopDragging);
        };
    }
    handleDragMove(e) {
        if (!this.isDragging || !this.activeNode) return;
        const canvas = document.querySelector('.canvas-container');
        const canvasRect = canvas.getBoundingClientRect();
        const currentX = e.clientX - canvasRect.left;
        const currentY = e.clientY - canvasRect.top;
        const dx = currentX - this.dragStartX;
        const dy = currentY - this.dragStartY;
        const newX = this.nodeInitialPos.x + dx;
        const newY = this.nodeInitialPos.y + dy;
        this.activeNode.setPosition(newX, newY);
        requestAnimationFrame(() => {
            this.updateNodeConnections(this.activeNode);
        });
        e.preventDefault();
    }
    updateNodeConnections(node) {
        const relevantConnections = this.getNodeConnections(node);
        relevantConnections.forEach(conn => {
            if (!conn.isDestroyed) {
                conn.updatePosition();
            }
        });
    }
    setupEventListeners() {
        console.log('[Canvas] Setting up event listeners');
        if (!this.container) {
            console.error('Canvas container not found');
            return;
        }
        try {
            this.handleMouseDown = this.handleMouseDown.bind(this);
            this.handleMouseMove = this.handleMouseMove.bind(this);
            this.handleMouseUp = this.handleMouseUp.bind(this);
            this.boundHandleConnectionStart = this.handleConnectionStart.bind(this);
            this.boundHandleConnectionMove = this.handleConnectionMove.bind(this);
            this.boundHandleConnectionEnd = this.handleConnectionEnd.bind(this);
            this.isDragging = false;
            this.lastX = null;
            this.lastY = null;
            this.initialNodePositions = new Map();
            this.container.addEventListener('mousedown', this.handleMouseDown);
            this.container.addEventListener('dragover', this.handleDragOver.bind(this));
            this.container.addEventListener('drop', this.handleDrop.bind(this));
            this.container.addEventListener('wheel', (e) => {
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    this.handleWheel(e);
                }
            });
            document.addEventListener('nodeMoved', this.handleNodeMoved.bind(this));
            document.addEventListener('nodeDestroyed', this.handleNodeDestroyed.bind(this));
            document.addEventListener('attributeFoldChanged', this.handleAttributeFoldChanged.bind(this));
            document.addEventListener('keydown', this.handleKeyDown.bind(this));

            document.addEventListener('connectionMove', this.boundHandleConnectionMove);
            document.addEventListener('connectionEnd', this.boundHandleConnectionEnd);
            this.container.addEventListener('click', (e) => {
                if (e.target === this.container) {
                    this.clearSelection();
                    e.stopPropagation();
                }
            });
            window.addEventListener('resize', () => {
                requestAnimationFrame(() => {
                    if (this.updateConnections) {
                        this.updateConnections();
                    }
                });
            });
            this.cleanup = () => {
                console.log('[Canvas] Cleaning up event listeners');
                this.container.removeEventListener('mousedown', this.handleMouseDown);
                this.container.removeEventListener('dragover', this.handleDragOver);
                this.container.removeEventListener('drop', this.handleDrop);
                this.container.removeEventListener('wheel', this.handleWheel);
                document.removeEventListener('mousemove', this.handleMouseMove);
                document.removeEventListener('mouseup', this.handleMouseUp);
                document.removeEventListener('nodeMoved', this.handleNodeMoved);
                document.removeEventListener('nodeDestroyed', this.handleNodeDestroyed);
                document.removeEventListener('attributeFoldChanged', this.handleAttributeFoldChanged);
                document.removeEventListener('keydown', this.handleKeyDown);
                document.removeEventListener('connectionStart', this.boundHandleConnectionStart);
                document.removeEventListener('connectionMove', this.boundHandleConnectionMove);
                document.removeEventListener('connectionEnd', this.boundHandleConnectionEnd);
                window.removeEventListener('resize', this.updateConnections);
            };
            console.log('[Canvas] Event listeners setup completed');
        } catch (error) {
            console.error('[Canvas] Error setting up event listeners:', error);
            throw error;
        }
    }
    handleNodeAttributeFold(node, isFolded) {
        const nodeConnections = this.getNodeConnections(node);
        nodeConnections.forEach(connection => {
            connection.setFolded(isFolded);
        });
        if (isFolded) {
            this.createOrUpdateMainConnection(node);
        } else {
            this.removeMainConnection(node);
        }
        this.scheduleRender();
    }
    handleAttributeFoldChanged(event) {
        const { node, isFolded } = event.detail;
        console.log('Handling attribute fold change:', {
            nodeId: node?.id,
            isFolded,
            timestamp: Date.now()
        });
        if (!node) return;
        try {
            const sourceConnections = Array.from(this.connections.values())
                .filter(conn => conn.sourceNode === node);
            console.log('Found source connections:', sourceConnections.length);
            sourceConnections.forEach(connection => {
                connection.setFolded(isFolded);
            });
            this.scheduleRender();
            console.log('Attribute fold change handled successfully');
        } catch (error) {
            console.error('Error handling attribute fold change:', error);
        }
    }
    areNodesConnected(node1, node2) {
        return Array.from(this.connections.values()).some(conn =>
            (conn.sourceNode === node1 && conn.targetNode === node2) ||
            (conn.sourceNode === node2 && conn.targetNode === node1)
        );
    }
    removeExistingConnections(node) {
    if (!node) return;
    const mainConnection = this.connections.get('main-' + node.id);
    if (mainConnection) {
        mainConnection.element.style.opacity = '0';
        setTimeout(() => {
            mainConnection.destroy();
            this.connections.delete('main-' + node.id);
        }, 300);
    }
}
    getConnectionsFromNode(node) {
        return Array.from(this.connections.values())
            .filter(conn => conn.sourceNode === node);
    }
    getConnectionsToNode(node) {
        if (!node) return [];
        return Array.from(this.connections.values()).filter(conn =>
            conn.targetNode === node && conn.type !== 'main'
        );
    }
    removeMainConnection(node) {
        const mainConnection = Array.from(this.connections.values())
            .find(conn => conn.isMain && conn.targetNode === node);
        if (mainConnection) {
            mainConnection.destroy();
            this.connections.delete(`main-${node.id}`);
        }
    }
    createOrUpdateMainConnection(node) {
        const connections = this.getNodeConnections(node);
        if (connections.length === 0) return;
        let mainConnection = this.findMainConnection(node);
        if (!mainConnection) {
            const mainInputPoint = node.element.querySelector('.attributes-input-point');
            if (!mainInputPoint) return;
            mainConnection = new Connection(
                connections[0].sourceNode,
                node,
                'main',
                connections[0].sourcePoint,
                mainInputPoint
            );
            mainConnection.isMain = true;
            this.connections.set(`main-${node.id}`, mainConnection);
        }
        const colors = connections.map(conn =>
            getComputedStyle(document.documentElement)
                .getPropertyValue(`--feature-${conn.type}-base`)
        );
        mainConnection.setGradientColors(colors);
        mainConnection.updatePosition();
    }
    findMainConnection(node) {
        return Array.from(this.connections.values())
            .find(conn => conn.isMain && (conn.sourceNode === node || conn.targetNode === node));
    }
    getNodeConnections(node) {
        if (!node) {
            console.warn('[Canvas] getNodeConnections called with no node');
            return [];
        }
        return Array.from(this.connections.values())
            .filter(conn =>
                (conn.sourceNode === node || conn.targetNode === node) &&
                !conn.isDestroyed
            );
    }
    createMainConnection(node) {
        const mainConnection = new Connection(
            node,
            null,
            'main',
            node.mainOutputPoint,
            node.mainInputPoint
        );
        mainConnection.isMain = true;
        this.connections.set(mainConnection.id, mainConnection);
        return mainConnection;
    }
    getConnectionsFromNode(node) {
        return Array.from(this.connections.values())
            .filter(conn => conn.sourceNode === node);
    }
    clearSelection() {
        this.selectedNodes.forEach(node => node.deselect());
        this.selectedNodes = [];
    }
    setupContextMenu() {
        this.container.addEventListener('contextmenu', (e) => {
            if (e.target === this.container) {
                e.preventDefault();
                this.showContextMenu(e);
            }
        });
    }
    handleSettingsChange() {
        const newSettings = {
            model: this.settings.model?.value || 'dall-e-2',
            size: this.settings.size?.value || '512x512',
            quality: this.settings.quality?.value || 'standard'
        };
        this.currentSettings = newSettings;
        this.dispatchEvent('settingsChanged', {
            settings: newSettings
        });
        localStorage.setItem('generationSettings', JSON.stringify(newSettings));
    }
    handleError(error, context) {
        console.error(`Error in ${context}:`, error);
        const message = error.message || 'An unexpected error occurred';
        this.showNotification(message, 'error');
        this.isProcessing = false;
        this.isGenerating = false;
        this.updateButtonStates();
    }
    showContextMenu(event) {
        const existingMenu = document.querySelector('.context-menu');
        if (existingMenu) {
            existingMenu.remove();
        }
        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.innerHTML = `
            <div class="menu-item" data-action="add-empty">Add Empty Frame</div>
            ${this.nodes.length > 0 ? '<div class="menu-item" data-action="clear">Clear Canvas</div>' : ''}
        `;
        const canvasRect = this.container.getBoundingClientRect();
        const x = event.clientX - canvasRect.left;
        const y = event.clientY - canvasRect.top;
        menu.style.position = 'absolute';
        menu.style.left = `${event.clientX}px`;
        menu.style.top = `${event.clientY}px`;
        const handleMenuClick = (e) => {
            const action = e.target.dataset.action;
            switch(action) {
                case 'add-empty':
                    this.addEmptyFrame(x, y);
                    break;
                case 'clear':
                    if (confirm('Are you sure you want to clear the canvas?')) {
                        this.clear();
                    }
                    break;
            }
            menu.remove();
        };
        menu.addEventListener('click', handleMenuClick);
        document.body.appendChild(menu);
        const closeMenu = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };
        setTimeout(() => {
            document.addEventListener('click', closeMenu);
        }, 0);
    }
    handleConnectionValueChanged(e) {
        const { connection, value, skipBalancing } = e.detail;
        if (!skipBalancing) {
            this.balanceConnectedWeights(connection);
        }
        connection.updateVisuals();
        connection.targetNode.handleFeatureUpdate({
            detail: {
                connection,
                value
            }
        });
    }
    balanceConnectedWeights(changedConnection) {
        const connections = Array.from(this.connections.values()).filter(conn =>
            conn !== changedConnection &&
            conn.targetNode === changedConnection.targetNode &&
            conn.type === changedConnection.type
        );
        if (connections.length === 0) return;
        const remainingWeight = 1 - changedConnection.value;
        const totalWeight = connections.reduce((sum, conn) => sum + conn.value, 0);
        connections.forEach(conn => {
            const newWeight = totalWeight > 0
                ? (conn.value / totalWeight) * remainingWeight
                : remainingWeight / connections.length;
            conn.setValue(newWeight, true);
        });
    }
    addNode(node) {
        try {
            this.nodes.push(node);
            this.container.appendChild(node.element);
            if (!node.position) {
                const position = this.getRandomPosition();
                node.setPosition(position.x, position.y);
            }
            this.addToHistory();
            return node;
        } catch (error) {
            console.error('Error adding node:', error);
            return null;
        }
    }
    async createImageNode(imageUrl, prompt, analysis) {
        try {
            if (!imageUrl) {
                throw new Error('Image URL is required');
            }
            const node = new Node(Date.now().toString(), imageUrl, prompt);
            const position = this.getRandomPosition();
            node.setPosition(position.x, position.y);
            if (analysis) {
                node.featureAnalysis = analysis;
            }
            const addedNode = this.addNode(node);
            if (!addedNode) {
                throw new Error('Failed to add node to canvas');
            }
            this.addToHistory();
            this.scheduleRender();
            return addedNode;
        } catch (error) {
            console.error('Failed to create image node:', error);
            this.showNotification('Failed to create image node', 'error');
            throw error;
        } finally {
            this.nodes.forEach(node => {
                node.element.style.pointerEvents = 'auto';
                node.isProcessing = false;
            });
        }
    }
    addEmptyFrame(x, y) {
        try {
            if (this.isProcessing) {
                throw new Error('Canvas is currently processing');
            }
            const node = new Node(Date.now().toString(), null, null);
            this.nodes.push(node);
            if (this.container) {
                this.container.appendChild(node.element);
            }
            const position = {
                x: x !== undefined ? x - node.element.offsetWidth / 2 : this.getRandomPosition().x,
                y: y !== undefined ? y - node.element.offsetHeight / 2 : this.getRandomPosition().y
            };
            node.setPosition(position.x, position.y);
            this.addToHistory();
            return node;
        } catch (error) {
            console.error('Error adding empty frame:', error);
            throw error;
        }
    }
    handleDrop(e) {
        e.preventDefault();
        const canvasRect = this.container.getBoundingClientRect();
        const x = e.clientX - canvasRect.left;
        const y = e.clientY - canvasRect.top;
        if (e.dataTransfer.files.length > 0) {
            const file = e.dataTransfer.files[0];
            if (file.type.startsWith('image/')) {
                this.handleImageDrop(file, x, y);
            }
        }
    }
    async handleImageDrop(file, x, y) {
        try {
            const reader = new FileReader();
            const imageUrl = await new Promise((resolve, reject) => {
                reader.onload = e => resolve(e.target.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
            const node = new Node(Date.now().toString(), imageUrl, file.name);
            node.setPosition(
                x - 128,
                y - 128
            );
            this.addNode(node);
            this.addToHistory();
        } catch (error) {
            console.error('Error handling image drop:', error);
            this.showNotification('Failed to load image', 'error');
        }
    }
    validateConnectionParams(sourceNode, targetNode) {
        if (!sourceNode || !targetNode) {
            console.warn('Invalid nodes for connection');
            return false;
        }
        if (sourceNode === targetNode) {
            console.warn('Cannot connect node to itself');
            return false;
        }
        if (sourceNode.isEmptyFrame) {
            console.warn('Empty frames cannot be source nodes');
            return false;
        }
        const existingConnections = Array.from(this.connections.values()).filter(
            conn => conn.targetNode === targetNode
        );
        if (existingConnections.length >= 5) {
            console.warn('Maximum connections reached for target node');
            return false;
        }
        return true;
    }
    createConnection(sourceNode, targetNode, type, sourcePoint, targetPoint) {
        try {
            console.log('[Canvas] Creating connection:', {
                sourceNodeId: sourceNode?.id,
                targetNodeId: targetNode?.id,
                type,
                hasSourcePoint: !!sourcePoint,
                hasTargetPoint: !!targetPoint
            });
            if (!sourceNode || !targetNode || !type) {
                console.warn('[Canvas] Invalid parameters for connection:', {
                    hasSourceNode: !!sourceNode,
                    hasTargetNode: !!targetNode,
                    type
                });
                return null;
            }
            const existingConnection = Array.from(this.connections.values()).find(conn =>
                conn.sourceNode === sourceNode &&
                conn.targetNode === targetNode &&
                conn.type === type
            );
            console.log('[Canvas] Connection context:', {
                hasExistingConnection: !!existingConnection,
                existingConnectionId: existingConnection?.id,
                sourceNodeFeatures: sourceNode ? Array.from(sourceNode.connectedFeatures.keys()) : [],
                targetNodeFeatures: targetNode ? Array.from(targetNode.connectedFeatures.keys()) : []
            });
            if (existingConnection) {
                console.log('[Canvas] Returning existing connection:', existingConnection.id);
                return existingConnection;
            }
            console.log('[Canvas] Creating new Connection instance...');
            const connection = new Connection(
                sourceNode,
                targetNode,
                type,
                sourcePoint || sourceNode.element.querySelector(`.attribute-point[data-type="${type}"]`),
                targetPoint || targetNode.element.querySelector('.attributes-input-point')
            );
            console.log('[Canvas] New connection created:', {
                connectionId: connection?.id,
                hasElement: !!connection?.element
            });
            this.connections.set(connection.id, connection);
            console.log('[Canvas] Notifying nodes about new connection');
            console.log('[Canvas] Notifying source node:', sourceNode.id);
            const sourceEvent = new CustomEvent('connectionCreated', {
                bubbles: true,
                detail: { connection }
            });
            sourceNode.element.dispatchEvent(sourceEvent);
            console.log('[Canvas] Notifying target node:', targetNode.id);
            const targetEvent = new CustomEvent('connectionCreated', {
                bubbles: true,
                detail: { connection }
            });
            targetNode.element.dispatchEvent(targetEvent);
            requestAnimationFrame(() => {
                console.log('[Canvas] Updating nodes state after connection creation');
                sourceNode.dispatchEvent('connectionsUpdated', { connection });
                targetNode.dispatchEvent('connectionsUpdated', { connection });
            });
            console.log('[Canvas] Connection creation completed:', {
                connectionId: connection.id,
                sourceFeatures: sourceNode.connectedFeatures.size,
                targetFeatures: targetNode.connectedFeatures.size
            });
            return connection;
        } catch (error) {
            console.error('[Canvas] Error creating connection:', error);
            return null;
        }
    }
    handleConnectionCreated(event) {
        try {
            console.log(`[Node ${this.id}] Received connectionCreated event:`, {
                eventType: event.type,
                hasDetail: !!event.detail,
                hasConnection: !!event.detail?.connection,
                currentFeatures: Array.from(this.connectedFeatures.entries())
            });
            const connection = event.detail?.connection;
            if (!connection) {
                console.warn(`[Node ${this.id}] No connection in event detail`);
                return;
            }
            const isSource = connection.sourceNode === this;
            const isTarget = connection.targetNode === this;
            const type = connection.type;
            console.log(`[Node ${this.id}] Processing connection:`, {
                connectionId: connection.id,
                type,
                isSource,
                isTarget,
                existingFeatures: Array.from(this.connectedFeatures.keys())
            });
            this.connectedFeatures.set(type, {
                connection,
                sourceNode: connection.sourceNode,
                targetNode: connection.targetNode,
                weight: connection.value || 0.5
            });
            console.log(`[Node ${this.id}] Features updated:`, {
                type,
                newFeatureCount: this.connectedFeatures.size,
                allFeatures: Array.from(this.connectedFeatures.keys())
            });
            if (this.element) {
                const point = this.element.querySelector(`.attribute-point[data-type="${type}"]`);
                if (point) {
                    point.classList.add('connected');
                    console.log(`[Node ${this.id}] Updated attribute point:`, {
                        type,
                        classList: point.classList.toString()
                    });
                }
                if (isTarget) {
                    const inputPoint = this.element.querySelector('.attributes-input-point');
                    if (inputPoint) {
                        inputPoint.classList.add('connected');
                    }
                }
            }
            if (isTarget && this.isEmptyFrame) {
                console.log(`[Node ${this.id}] Updating empty frame status`);
                this.updateGenerationStatus();
            }
            console.log(`[Node ${this.id}] Connection handling completed:`, {
                finalFeatureCount: this.connectedFeatures.size,
                features: Array.from(this.connectedFeatures.keys())
            });
        } catch (error) {
            console.error(`[Node ${this.id}] Error handling connection:`, error);
        }
    }
    getConnectionPoints(sourceNode, targetNode, type) {
        let sourcePoint, targetPoint;
        if (sourceNode.isAttributesFolded) {
            sourcePoint = sourceNode.element.querySelector('.attributes-output-point');
        } else {
            sourcePoint = sourceNode.element.querySelector(`.attribute-point[data-type="${type}"]`);
        }
        targetPoint = targetNode.element.querySelector('.attributes-input-point');
        return {
            validSourcePoint: sourcePoint,
            validTargetPoint: targetPoint
        };
    }
    findExistingConnection(sourceNode, targetNode, type) {
        return Array.from(this.connections.values()).find(conn =>
            conn.sourceNode === sourceNode &&
            conn.targetNode === targetNode &&
            conn.type === type
        );
    }
    updateConnectionPointsState(sourcePoint, targetPoint, isConnected) {
        if (sourcePoint) {
            sourcePoint.classList.toggle('connected', isConnected);
        }
        if (targetPoint) {
            targetPoint.classList.toggle('connected', isConnected);
        }
    }
    removeConnection(type, connection) {
        try {
            if (!this.connectedFeatures.has(type)) return;
            const connections = this.connectedFeatures.get(type);
            const index = connections.findIndex(data => data.connection === connection);
            if (index !== -1) {
                const data = connections[index];
                if (data.connection._originalSourcePoint) {
                    Object.assign(data.connection._originalSourcePoint.style, {
                        opacity: '1',
                        visibility: 'visible',
                        pointerEvents: 'auto'
                    });
                }
                connections.splice(index, 1);
                data.connection.destroy();
                if (connections.length === 0) {
                    this.connectedFeatures.delete(type);
                }
                if (this.isEmptyFrame) {
                    this.updateGenerationStatus();
                }
                this.dispatchEvent('connectionRemoved', {
                    type,
                    connection: data.connection
                });
            }
        } catch (error) {
            console.error('Error removing connection:', error);
        }
    }
    clearConnectionGroups() {
        this.connectionGroups.clear();
    }
    getConnectionGroup(nodeId) {
        return this.connectionGroups.get(nodeId) || new Set();
    }
    handleConnectionStart(e) {
        const { node, point, type, x, y } = e.detail;
        console.log('Canvas handleConnectionStart triggered', e.detail);

        this.removeTemporaryConnection();

        const element = this.createTemporaryConnectionElement(type);
        if (!element) {
            console.error('Failed to create temporary connection element');
            return;
        }

        this.temporaryConnection = {
            sourceNode: node,
            sourcePoint: point,
            type,
            element
        };

        this.container.appendChild(element);
        this.isTemporaryVisible = true;

        this.container.style.pointerEvents = 'auto';
        this.nodes.forEach(nd => {
          nd.element.style.pointerEvents = 'auto';
        });

        this.updateTemporaryConnection(x, y);

        document.addEventListener('mousemove', this.boundHandleConnectionMove);
        document.addEventListener('mouseup', this.boundHandleConnectionEnd);

        console.log('Connection start initialized:', this.temporaryConnection);
    }

    findConnectionBySource(node, type) {
        return Array.from(this.connections.values())
            .find(conn => conn.sourceNode === node && conn.type === type);
    }
    findConnectionByTarget(node, type) {
        return Array.from(this.connections.values()).find(conn =>
            conn.targetNode === node && conn.type === type
        );
    }
    getConnectionById(id) {
        return this.connections.get(id);
    }
    getAllConnections() {
        return Array.from(this.connections.values());
    }
    validateConnection(sourceNode, targetNode, type) {
        try {
            if (!sourceNode || !targetNode) {
                console.warn('Invalid nodes for connection', {
                    hasSourceNode: !!sourceNode,
                    hasTargetNode: !!targetNode
                });
                return false;
            }
            if (sourceNode === targetNode) {
                console.warn('Cannot connect node to itself');
                return false;
            }
            if (sourceNode.isDestroyed || targetNode.isDestroyed) {
                console.warn('Cannot connect to destroyed node');
                return false;
            }
            if (sourceNode.isEmptyFrame) {
                console.warn('Empty frames cannot be source nodes');
                return false;
            }
            const targetConnections = Array.from(this.connections.values())
                .filter(conn => conn.targetNode === targetNode);
            if (targetConnections.length >= 20) {
                console.warn('Maximum connections (20) reached for target node');
                return false;
            }
            return true;
        } catch (error) {
            console.error('Error validating connection:', error);
            return false;
        }
    }
    addToConnectionGroup(nodeId, connection) {
        if (!this.connectionGroups.has(nodeId)) {
            this.connectionGroups.set(nodeId, new Set());
        }
        this.connectionGroups.get(nodeId).add(connection);
    }
    checkNodeSpacing(node, position) {
        const minSpacing = 50;
        const colliding = this.nodes.some(otherNode => {
            if (otherNode === node) return false;
            const dx = position.x - otherNode.position.x;
            const dy = position.y - otherNode.position.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            return distance < minSpacing;
        });
        return !colliding;
    }
    getCanvasState() {
        return {
            nodes: this.nodes.map(node => ({
                id: node.id,
                position: node.position,
                state: node.getState()
            })),
            connections: Array.from(this.connections.values()).map(conn => conn.getState()),
            attributesExpandedState: this.attributesExpandedState
        };
    }
    canStartConnection(node, point, type) {
        if (!point.classList.contains('attribute-point')) {
            return false;
        }
        const existingConnection = this.findConnectionBySource(node, type);
        if (existingConnection) {
            this.showNotification('This attribute is already connected', 'warning');
            return false;
        }
        return true;
    }
    handleConnectionMove(e) {
        if (!this.temporaryConnection || !this.isTemporaryVisible) return;
        const x = e.detail?.x || e.clientX;
        const y = e.detail?.y || e.clientY;
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            console.warn('Invalid coordinates in handleConnectionMove');
            return;
        }
        this.updateTemporaryConnection(x, y);
    }
    isValidConnection(sourceType, targetType, sourceNode, targetNode) {
        if (!sourceNode || !targetNode || sourceNode === targetNode) {
            return false;
        }
        return true;
    }
    hasExistingConnection(targetNode, type) {
        const existingConnections = Array.from(this.connections.values());
        return existingConnections.some(conn =>
            conn.targetNode === targetNode && conn.type === type
        );
    }
    createTemporaryConnectionElement(type) {
        const element = document.createElement('div');
        element.className = 'connection temporary';
        element.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 1001;
        `;
        element.innerHTML = `
            <svg width="100%" height="100%" style="position: absolute; top: 0; left: 0;">
                <defs>
                    <linearGradient id="temp-gradient-${Date.now()}" gradientUnits="userSpaceOnUse">
                        <stop offset="0%" stop-color="var(--feature-${type}-base)"/>
                        <stop offset="100%" stop-color="var(--feature-${type}-dark)"/>
                    </linearGradient>
                </defs>
                <path class="connection-line"
                    stroke="url(#temp-gradient-${Date.now()})"
                    stroke-width="2"
                    fill="none"
                    stroke-dasharray="4 4"/>
            </svg>
        `;
        return element;
    }
    handleConnectionEnd(e) {
        if (!this.temporaryConnection) {
            console.log('[Canvas] No temporaryConnection to finalize');
            return;
        }
        try {
            const x = e.detail?.x || e.clientX;
            const y = e.detail?.y || e.clientY;
            console.log('[handleConnectionEnd]', { x, y });

            const elements = document.elementsFromPoint(x, y);
            const targetPoint = elements.find(el =>
                el.classList && (
                    el.classList.contains('attributes-input-point') ||
                    el.classList.contains('attribute-point')
                )
            );

            if (targetPoint) {
                const targetNodeEl = targetPoint.closest('.node');
                const targetNode = this.findNodeByElement(targetNodeEl);
                const sourceNode = this.temporaryConnection.sourceNode;
                const type = this.temporaryConnection.type;

                if (targetNode && sourceNode && sourceNode !== targetNode) {
                    if (this.validateConnection(sourceNode, targetNode, type)) {
                        const connection = this.createConnection(
                            sourceNode,
                            targetNode,
                            type,
                            this.temporaryConnection.sourcePoint,
                            targetPoint
                        );
                        console.log('[handleConnectionEnd] Created connection:', connection?.id);
                    }
                }
            }
        } catch (err) {
            console.error('[Canvas] Error in handleConnectionEnd:', err);
        } finally {
            this.removeTemporaryConnection();
            document.removeEventListener('mousemove', this.boundHandleConnectionMove);
            document.removeEventListener('mouseup', this.boundHandleConnectionEnd);
        }
    }
    resetInteractionState() {
        if (!this.container) return;
        this.container.style.pointerEvents = 'auto';
        this.container.style.cursor = 'default';
        requestAnimationFrame(() => {
            this.nodes.forEach(node => {
                if (!node.element) return;
                node.element.style.pointerEvents = 'auto';
                node.element.style.cursor = 'move';
                node.element.style.opacity = '1';
                node.isDragging = false;
                node.isProcessing = false;
                const interactiveElements = node.element.querySelectorAll(
                    'button, input, .attribute-point, .attributes-input-point, .sections-container, .section-header'
                );
                interactiveElements.forEach(element => {
                    element.style.pointerEvents = 'auto';
                    if (element.classList.contains('attribute-point') ||
                        element.classList.contains('attributes-input-point')) {
                        element.style.cursor = 'pointer';
                    }
                });
                const attributesSection = node.element.querySelector('.attributes-section');
                if (attributesSection) {
                    attributesSection.style.pointerEvents = 'auto';
                    attributesSection.style.opacity = '1';
                }
            });
            this.connections.forEach(connection => {
                if (connection.element) {
                    connection.element.style.pointerEvents = 'none';
                    connection.element.style.opacity = '1';
                }
            });
        });
    }
    findNodeByElement(element) {
        if (!element) {
            console.log('No element provided to findNodeByElement');
            return null;
        }
        const node = this.nodes.find(n => n.element === element);
        if (node) {
            console.log('Found node:', node.id);
        } else {
            console.log('No node found for element');
        }
        return node;
    }
    canCreateConnection(sourceNode, targetNode, type) {
        const existingConnection = Array.from(this.connections.values()).find(conn =>
            conn.targetNode === targetNode && conn.type === type
        );
        if (existingConnection) {
            this.showNotification('This attribute is already connected', 'error');
            return false;
        }
        if (!targetNode.isEmptyFrame) {
            this.showNotification('Can only connect to generation frames', 'error');
            return false;
        }
        return true;
    }
    updateTemporaryConnection(x, y) {
        if (!this.temporaryConnection || !this.temporaryConnection.sourcePoint) {
            return;
        }
        const canvasRect = this.container.getBoundingClientRect();
        const sourceRect = this.temporaryConnection.sourcePoint.getBoundingClientRect();
        const sourceX = sourceRect.left + sourceRect.width / 2 - canvasRect.left;
        const sourceY = sourceRect.top + sourceRect.height / 2 - canvasRect.top;
        const targetX = x - canvasRect.left;
        const targetY = y - canvasRect.top;
        if (!Number.isFinite(sourceX) || !Number.isFinite(sourceY) ||
            !Number.isFinite(targetX) || !Number.isFinite(targetY)) {
            console.warn('Invalid coordinates in updateTemporaryConnection');
            return;
        }
        const path = this.calculateConnectionPath(
            { x: sourceX, y: sourceY },
            { x: targetX, y: targetY }
        );
        const pathElement = this.temporaryConnection.element.querySelector('.connection-line');
        if (pathElement) {
            pathElement.setAttribute('d', path);
        }
    }
    removeTemporaryConnection() {
        if (!this.temporaryConnection) return;
        const tempEl = this.temporaryConnection.element;
        if (tempEl && tempEl.parentNode) {
            tempEl.parentNode.removeChild(tempEl);
        }
        this.temporaryConnection = null;
        this.isTemporaryVisible = false;
        console.log('[Canvas] Temporary connection removed');
    }
    calculateConnectionPath(source, target) {
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
    handleNodeMoved(e) {
        console.log('[Canvas] handleNodeMoved start:', {
            nodeId: e.detail?.node?.id,
            hasNode: !!e.detail?.node,
            connections: Array.from(this.connections.values()).length
        });
        const { node } = e.detail;
        if (!node || node.isDestroyed) return;
        try {
            const hasTransitioning = Array.from(this.connections.values())
                .some(conn => conn.isTransitioning);
            if (hasTransitioning) {
                console.log('[Canvas] Skipping - has transitioning connections');
                return;
            }
            this.connections.forEach(connection => {
                if (connection.sourceNode === node || connection.targetNode === node) {
                    if (node.isAttributesFolded && connection.sourceNode === node) {
                        const mainOutput = node.element.querySelector('.attributes-output-point');
                        if (mainOutput && !connection.element.classList.contains('using-main-point')) {
                            node._switchConnectionToMainOutput({
                                type: connection.type,
                                connection
                            });
                        }
                    }
                    requestAnimationFrame(() => {
                        if (!connection.isDestroyed) {
                            connection.updatePosition();
                        }
                    });
                }
            });
            if (node.isAttributesFolded) {
                requestAnimationFrame(() => {
                    node.updateConnectionsVisibility();
                });
            }
            this.addToHistory();
            console.log('[Canvas] Node move handled successfully');
        } catch (error) {
            console.error('[Canvas] Handle move error:', error);
            this.connections.forEach(connection => {
                if ((connection.sourceNode === node || connection.targetNode === node)
                    && !connection.isDestroyed) {
                    connection.updatePosition();
                }
            });
        }
     }
    handleConnectionDestroyed(e) {
        const connection = e.detail.connection;
        const index = this.connections.indexOf(connection);
        if (index !== -1) {
            this.connections.splice(index, 1);
            connection.sourceNode.updateConnectedFeatures();
            connection.targetNode.updateConnectedFeatures();
            this.addToHistory();
        }
    }
    handleNodeDestroyed(e) {
        const node = e.detail.node;
        this.connections = new Map(
            Array.from(this.connections.entries()).filter(([key, conn]) => {
                if (conn.sourceNode === node || conn.targetNode === node) {
                    conn.destroy();
                    return false;
                }
                return true;
            })
        );
        this.nodes = this.nodes.filter(n => n !== node);
        this.selectedNodes = this.selectedNodes.filter(n => n !== node);
        this.addToHistory();
    }
    handleKeyDown(e) {
        if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedNodes.length > 0) {
            e.preventDefault();
            this.deleteSelectedNodes();
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
            e.preventDefault();
            if (e.shiftKey) {
                this.redo();
            } else {
                this.undo();
            }
        }
    }
    handleWheel(e) {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const delta = e.deltaY;
            const direction = delta > 0 ? -1 : 1;
            const factor = 0.1;
            const scale = 1 + factor * direction;
            const rect = this.container.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            this.nodes.forEach(node => {
                const nodeX = node.position.x;
                const nodeY = node.position.y;
                const newX = x + (nodeX - x) * scale;
                const newY = y + (nodeY - y) * scale;
                node.setPosition(newX, newY);
            });
        }
    }
    autoLayoutNodes() {
        if (this.nodes.length <= 1) return;
        const PADDING = 50;
        const NODE_SIZE = 256;
        const LEVEL_HEIGHT = NODE_SIZE + PADDING * 2;
        const levels = this.createNodeLevels();
        levels.forEach((nodes, level) => {
            const levelWidth = nodes.length * (NODE_SIZE + PADDING);
            const startX = (this.container.offsetWidth - levelWidth) / 2;
            nodes.forEach((node, index) => {
                const x = startX + index * (NODE_SIZE + PADDING);
                const y = PADDING + level * LEVEL_HEIGHT;
                node.setPosition(x, y);
            });
        });
        this.scheduleRender();
        this.addToHistory();
    }
    createNodeLevels() {
        const levels = new Map();
        const visited = new Set();
        const rootNodes = this.nodes.filter(node => {
            return !this.connections.some(conn => conn.targetNode === node);
        });
        const queue = rootNodes.map(node => ({ node, level: 0 }));
        while (queue.length > 0) {
            const { node, level } = queue.shift();
            if (visited.has(node)) continue;
            visited.add(node);
            if (!levels.has(level)) {
                levels.set(level, []);
            }
            levels.get(level).push(node);
            const outgoingConnections = this.connections.filter(conn =>
                conn.sourceNode === node
            );
            outgoingConnections.forEach(conn => {
                queue.push({ node: conn.targetNode, level: level + 1 });
            });
        }
        return levels;
    }
    centerView() {
        if (this.nodes.length === 0) return;
        const bounds = this.getNodesBounds();
        const containerWidth = this.container.offsetWidth;
        const containerHeight = this.container.offsetHeight;
        const dx = (containerWidth / 2) - (bounds.centerX);
        const dy = (containerHeight / 2) - (bounds.centerY);
        this.nodes.forEach(node => {
            node.setPosition(
                node.position.x + dx,
                node.position.y + dy
            );
        });
        this.scheduleRender();
    }
    getNodesBounds() {
        if (this.nodes.length === 0) return null;
        const bounds = {
            left: Infinity,
            top: Infinity,
            right: -Infinity,
            bottom: -Infinity
        };
        this.nodes.forEach(node => {
            bounds.left = Math.min(bounds.left, node.position.x);
            bounds.top = Math.min(bounds.top, node.position.y);
            bounds.right = Math.max(bounds.right, node.position.x + node.element.offsetWidth);
            bounds.bottom = Math.max(bounds.bottom, node.position.y + node.element.offsetHeight);
        });
        bounds.centerX = (bounds.left + bounds.right) / 2;
        bounds.centerY = (bounds.top + bounds.bottom) / 2;
        return bounds;
    }
    toggleAllAttributes() {
        this.attributesExpandedState = !this.attributesExpandedState;
        this.nodes.forEach(node => {
            if (node.isAttributesExpanded !== this.attributesExpandedState) {
                node.toggleAttributes();
            }
        });
        this.connections.forEach(connection => {
            connection.isExpanded = this.attributesExpandedState;
            connection.updateVisuals();
        });
        this.scheduleRender();
    }
    toggleAttributes() {
        const section = this.element.querySelector('.attributes-section');
        const content = section.querySelector('.section-content');
        const header = section.querySelector('.section-header');
        const toggle = header.querySelector('.section-toggle');
        this.isAttributesExpanded = !this.isAttributesExpanded;
        content.style.maxHeight = this.isAttributesExpanded ? content.scrollHeight + 'px' : '0';
        toggle.textContent = this.isAttributesExpanded ? '▼' : '▶';
        this.dispatchEvent('attributesToggled', {
            node: this,
            expanded: this.isAttributesExpanded
        });
    }
    dispatchEvent(eventName, detail) {
        const event = new CustomEvent(eventName, {
            bubbles: true,
            detail
        });
        this.container.dispatchEvent(event);
    }
    scheduleRender() {
        if (this.isRenderScheduled) return;
        this.isRenderScheduled = true;
        requestAnimationFrame(() => {
            try {
                this.render();
            } catch (error) {
                console.error('Error during render:', error);
            } finally {
                this.isRenderScheduled = false;
            }
        });
    }
    render() {
        this.nodes.forEach(node => {
            if (this.renderQueue.has(node)) {
                node.updateConnections();
            }
        });
        this.connections.forEach(connection => {
            if (this.renderQueue.has(connection)) {
                connection.updatePosition();
            }
        });
        this.renderQueue.clear();
    }
    updateConnections() {
        this.connections.forEach(connection => {
            if (!connection.isDestroyed) {
                connection.updatePosition();
            }
        });
    }
    addToHistory() {
        const state = this.getCurrentState();
        if (this.historyIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.historyIndex + 1);
        }
        this.history.push(state);
        this.historyIndex++;
        if (this.history.length > 50) {
            this.history.shift();
            this.historyIndex--;
        }
        this.updateUndoRedoState();
    }
    getCurrentState() {
        try {
            const nodes = this.nodes.map(node => {
                if (!node || node.isDestroyed) return null;
                const nodeState = {
                    id: node.id,
                    imageUrl: node.imageUrl,
                    prompt: node.prompt,
                    position: { ...node.position },
                    isAttributesExpanded: node.isAttributesExpanded,
                    featureAnalysis: node.featureAnalysis,
                    isAttributesFolded: node.isAttributesFolded,
                    connectedFeatures: []
                };
                if (node.connectedFeatures) {
                    nodeState.connectedFeatures = Array.from(node.connectedFeatures.entries())
                        .filter(([_, data]) => {
                            return data && data.sourceNode && data.connection &&
                                   !data.connection.isDestroyed;
                        })
                        .map(([type, data]) => ({
                            type,
                            sourceNodeId: data.sourceNode.id,
                            weight: data.weight || 0.5,
                            features: data.features || {}
                        }));
                }
                return nodeState;
            }).filter(Boolean);
            const connections = Array.from(this.connections.values())
                .filter(conn => {
                    return conn && !conn.isDestroyed &&
                           conn.sourceNode && conn.targetNode &&
                           !conn.sourceNode.isDestroyed && !conn.targetNode.isDestroyed;
                })
                .map(conn => {
                    return {
                        id: conn.id,
                        sourceNodeId: conn.sourceNode.id,
                        targetNodeId: conn.targetNode.id,
                        type: conn.type,
                        value: conn.value || 0.5,
                        isMain: conn.isMain || false,
                        isFolded: conn.isFolded || false
                    };
                });
            const foldedGroups = {};
            this.nodes.forEach(node => {
                if (node && !node.isDestroyed && node.foldedGroups) {
                    foldedGroups[node.id] = Array.from(node.foldedGroups);
                }
            });
            return {
                nodes,
                connections,
                attributesExpandedState: this.attributesExpandedState,
                foldedGroups
            };
        } catch (error) {
            console.error('Error getting canvas state:', error);
            return {
                nodes: [],
                connections: [],
                attributesExpandedState: true,
                foldedGroups: {}
            };
        }
    }
    restoreState(state) {
        this.clear();
        this.attributesExpandedState = state.attributesExpandedState;
        const nodesMap = new Map();
        state.nodes.forEach(nodeData => {
            const node = new Node(
                nodeData.id,
                nodeData.imageUrl,
                nodeData.prompt
            );
            node.position = nodeData.position;
            node.isAttributesExpanded = nodeData.isAttributesExpanded;
            node.featureAnalysis = nodeData.featureAnalysis;
            this.addNode(node);
            nodesMap.set(nodeData.id, node);
        });
        state.connections.forEach(connData => {
            const sourceNode = nodesMap.get(connData.sourceNodeId);
            const targetNode = nodesMap.get(connData.targetNodeId);
            if (sourceNode && targetNode) {
                const sourcePoint = this.findAttributePoint(sourceNode, connData.type);
                const targetPoint = this.findAttributePoint(targetNode, connData.type);
                if (sourcePoint && targetPoint) {
                    const connection = this.createConnection(
                        sourceNode,
                        targetNode,
                        connData.type,
                        sourcePoint,
                        targetPoint
                    );
                    if (connection) {
                        connection.setValue(connData.value, true);
                    }
                }
            }
        });
        this.scheduleRender();
    }
    findAttributePoint(node, type) {
        return node.element.querySelector(`.attribute-point[data-type="${type}"]`);
    }
    handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    }
    handleConnectionWeightFinalized(e) {
        const { connection, value } = e.detail;
        this.balanceConnectedWeights(connection);
    }
    undo() {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            this.restoreState(this.history[this.historyIndex]);
            this.updateUndoRedoState();
        }
    }
    redo() {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            this.restoreState(this.history[this.historyIndex]);
            this.updateUndoRedoState();
        }
    }
    updateUndoRedoState() {
        document.dispatchEvent(new CustomEvent('historyUpdated', {
            detail: {
                canUndo: this.historyIndex > 0,
                canRedo: this.historyIndex < this.history.length - 1
            }
        }));
    }
    clear() {
        [...this.connections].forEach(conn => conn.destroy());
        this.connections = [];
        [...this.nodes].forEach(node => node.destroy());
        this.nodes = [];
        this.selectedNodes = [];
        this.removeTemporaryConnection();
        this.scheduleRender();
        this.addToHistory();
    }
    getRandomPosition() {
        const margin = 50;
        const nodeWidth = 256;
        const nodeHeight = 256;
        const width = Math.max(0, this.container.offsetWidth - nodeWidth - margin * 2);
        const height = Math.max(0, this.container.offsetHeight - nodeHeight - margin * 2);
        return {
            x: margin + Math.random() * width,
            y: margin + Math.random() * height
        };
    }
    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification-card ${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);
        requestAnimationFrame(() => {
            notification.classList.add('visible');
        });
        setTimeout(() => {
            notification.classList.remove('visible');
            notification.addEventListener('transitionend', () => {
                notification.remove();
            }, { once: true });
        }, 3000);
    }
    destroy() {
        document.removeEventListener('connectionStart', this.boundHandleConnectionStart);
        document.removeEventListener('connectionMove', this.boundHandleConnectionMove);
        document.removeEventListener('connectionEnd', this.boundHandleConnectionEnd);
        document.removeEventListener('connectionDestroyed', this.boundHandleConnectionDestroyed);
        document.removeEventListener('nodeMoved', this.boundHandleNodeMoved);
        document.removeEventListener('nodeDestroyed', this.boundHandleNodeDestroyed);
        document.removeEventListener('keydown', this.boundHandleKeyDown);
        document.removeEventListener('connectionWeightFinalized', this.handleConnectionWeightFinalized);
        document.removeEventListener('settingsChanged', this.handleSettingsChange);
        this.container.removeEventListener('dragover', this.boundHandleDragOver);
        this.container.removeEventListener('drop', this.boundHandleDrop);
        this.container.removeEventListener('wheel', this.boundHandleWheel);
        this.clear();
        this.history = [];
        this.historyIndex = -1;
        if (this.debounceTimeout) {
            clearTimeout(this.debounceTimeout);
        }
    }
}
export default Canvas;