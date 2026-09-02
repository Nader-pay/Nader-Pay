// stub بسيط لـ expo/fetch في بيئة Node/Jest
module.exports = {
  fetch: global.fetch ?? require('node-fetch'),
};
