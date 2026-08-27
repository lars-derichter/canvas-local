/**
 * Build the JSX attribute value for `href={require("<loader>!<path>").default}`.
 * This mirrors `assetRequireAttributeValue` in Docusaurus's mdx-loader: the
 * estree is required so MDX can compile the expression at build time. file-loader
 * copies the asset into the build and its default export is the emitted URL.
 *
 * Shared by remark-html-links (anchor hrefs) and remark-file-item (video and
 * audio srcs).
 */
function requireAttributeValue(requireString) {
  return {
    type: 'mdxJsxAttributeValueExpression',
    value: `require("${requireString}").default`,
    data: {
      estree: {
        type: 'Program',
        sourceType: 'module',
        comments: [],
        body: [
          {
            type: 'ExpressionStatement',
            expression: {
              type: 'MemberExpression',
              computed: false,
              optional: false,
              object: {
                type: 'CallExpression',
                optional: false,
                callee: { type: 'Identifier', name: 'require' },
                arguments: [
                  {
                    type: 'Literal',
                    value: requireString,
                    raw: JSON.stringify(requireString),
                  },
                ],
              },
              property: { type: 'Identifier', name: 'default' },
            },
          },
        ],
      },
    },
  };
}

module.exports = { requireAttributeValue };
