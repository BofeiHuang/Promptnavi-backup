// AttributeTypes.js

export const AttributeTypes = {
    COLOR: {
        id: 'color',
        label: 'Color',
        icon: '🎨',
        description: 'Color palette and tone',
        cssVar: '--feature-color'
    },
    OBJECT: {
        id: 'object',
        label: 'Object',
        icon: '📦',
        description: 'Main subjects and elements',
        cssVar: '--feature-object'
    },
    STYLE: {
        id: 'style',
        label: 'Style',
        icon: '🎭',
        description: 'Artistic style and technique',
        cssVar: '--feature-style'
    },
    COMPOSITION: {
        id: 'composition',
        label: 'Composition',
        icon: '📐',
        description: 'Layout and arrangement',
        cssVar: '--feature-composition'
    },
    LIGHTING: {
        id: 'lighting',
        label: 'Lighting',
        icon: '💡',
        description: 'Light and shadow',
        cssVar: '--feature-lighting'
    },
    MOOD: {
        id: 'mood',
        label: 'Mood',
        icon: '🌟',
        description: 'Emotional atmosphere',
        cssVar: '--feature-mood'
    },
    OBJECT: {
        id: 'object',
        label: 'Object',
        icon: '🔲',
        description: 'Any subject or entity in the scene',
        cssVar: '--feature-Object'
    },
    PERSPECTIVE: {
        id: 'perspective',
        label: 'Perspective',
        icon: '👁️',
        description: 'Viewpoint and depth',
        cssVar: '--feature-perspective'
    },
    DETAIL: {
        id: 'detail',
        label: 'Detail',
        icon: '🔍',
        description: 'Level of detail and complexity',
        cssVar: '--feature-detail'
    },
    TEXTURE: {
        id: 'texture',
        label: 'Texture',
        icon: '🖌️',
        description: 'Surface and material quality',
        cssVar: '--feature-texture'
    }
};

// 辅助函数
export const getAttributeById = (id) => {
    return Object.values(AttributeTypes).find(attr => attr.id === id);
};

export const getDetectedAttributes = (analysis) => {
    return Object.values(AttributeTypes).filter(attr => {
        return analysis && analysis[attr.id] &&
               Object.keys(analysis[attr.id]).length > 0;
    });
};

export default AttributeTypes;