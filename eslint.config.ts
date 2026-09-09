import { renton } from "@renton/eslint-config";

export default renton({
  stylistic: {
    quotes: "double",
    semi: true,
  },
  typescript: true,
  jsonc: true,
  yaml: true,
  markdown: false,
}, {
  rules: {
    "no-use-before-define": "off",
    "unicorn/consistent-boolean-name": "off",
    "unicorn/consistent-class-member-order": "off",
    "unicorn/max-nested-calls": "off",
    "unicorn/name-replacements": "off",
    "unicorn/no-return-array-push": "off",
    "unicorn/no-this-outside-of-class": "off",
    "unicorn/no-top-level-assignment-in-function": "off",
    "unicorn/no-top-level-side-effects": "off",
    "unicorn/prefer-await": "off",
    "unicorn/prefer-default-parameters": "off",
  },
});
