export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce button elements have explicit type attribute',
      category: 'Best Practices',
      recommended: true,
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name.name !== 'button') return;

        const hasType = node.attributes.some(
          (attr) => attr.type === 'JSXAttribute' && attr.name.name === 'type'
        );

        if (!hasType) {
          context.report({
            node,
            message: 'Button elements must have an explicit type attribute (button, submit, or reset)',
          });
        }
      },
    };
  },
};
