module.exports = () => ({
  postcssPlugin: "freecoda-admin-scope",
  OnceExit(root, { postcss }) {
    root.walkAtRules("layer", layer => {
      if (layer.params !== "utilities" || !layer.nodes?.length) return;
      const scope = postcss.atRule({ name: "scope", params: "(.admin-ui)" });
      scope.append(layer.nodes);
      layer.append(scope);
    });
  },
});
module.exports.postcss = true;
