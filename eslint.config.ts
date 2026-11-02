import { renton } from "@renton/eslint-config";

export default renton({
  jsonc: true,
  markdown: false,
  stylistic: {
    quotes: "double",
    semi: true,
  },
  typescript: true,
  yaml: true,
}, {
  files: ["**/*.?([cm])[jt]s?(x)"],
  rules: {
    "unicorn/consistent-class-member-order": "off", // 与 preset 的 perfectionist/sort-classes 冲突（src/storage.ts TileStorage 上互斥）
    "unicorn/max-nested-calls": [
      "error",
      { max: 5 },
    ], // src/index.ts:146 OpenLayers layer/source/tileGrid 构造嵌套 5 层
    "unicorn/no-this-outside-of-class": "off", // src/index.ts:46/52 Image.prototype 补丁需要 this
    "unicorn/no-top-level-assignment-in-function": "off", // src/index.ts:161/169 模块级 renderLayer 重置
    "unicorn/no-top-level-side-effects": "off", // Hono / OpenLayers 模块顶层初始化
  },
});
