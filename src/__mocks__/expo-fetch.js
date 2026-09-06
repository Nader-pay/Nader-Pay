/* eslint-disable no-undef */
// stub بسيط لـ expo/fetch في بيئة Node/Jest
// biome-ignore lint/correctness/noUndeclaredDependencies: Jest mock — node-fetch اختياري في بيئة الاختبار
module.exports = {
  fetch: global.fetch ?? (() => { throw new Error('fetch not available in test environment'); }),
};
