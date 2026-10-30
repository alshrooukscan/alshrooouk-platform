// Merged Arabic dictionary. Later files win on a duplicate key; keep
// duplicates identical (the i18n check script reports any that differ).
import common from "./common";
import shell from "./shell";
import patients from "./patients";
import doctors_clients from "./doctors_clients";
import hr from "./hr";
import stock from "./stock";
import finance from "./finance";
import dashboard from "./dashboard";
import portals from "./portals";
import errors from "./errors";
import codes from "./codes";

const AR = {
  ...common,
  ...shell,
  ...patients,
  ...doctors_clients,
  ...hr,
  ...stock,
  ...finance,
  ...dashboard,
  ...portals,
  ...errors,
  ...codes,
};

export default AR;
