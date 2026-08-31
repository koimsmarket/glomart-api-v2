// GM_DATA_BUILDER_V055 - compatibility facade only.
// Actual logic is isolated under routes/builder/core/*.js.
module.exports = {
  ...require('./core/config'),
  ...require('./core/common'),
  ...require('./core/csv'),
  ...require('./core/schema'),
  ...require('./core/cafe24_member'),
  ...require('./core/category'),
};
