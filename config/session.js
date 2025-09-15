const session = require("express-session");

module.exports = session({
  secret: "mem",
  resave: false,
  saveUninitialized: true,
});
