// Ops number that receives the internal "Scan" message. Move to Settings/admin config in a later sprint.
const OPS_WHATSAPP_NUMBER = "+201288871871";

function encode(text) {
  return encodeURIComponent(text).replace(/%0A/g, "%0A");
}

export function buildCustomerMessage({ patientName, portalUrl, username, password }) {
  const text =
    `Hi ${patientName}. \n` +
    `Thank you for Visiting Al Shroouk Scan\n` +
    `All you Scans/Reports will be sent directly to your number\n\n` +
    `View your results here: ${portalUrl}\n` +
    `Username: ${username}\n` +
    `Password: ${password}`;
  return text;
}

export function buildScanMessage({ branch, patientName, mobile, email, scanTypes, doctorName, doctorPhone, doctorEmail, clinicCode }) {
  const text =
    `Branch: ${branch} \n` +
    `Paitent Info :\n` +
    `Name: ${patientName}\n` +
    `Phone: ${mobile}\n` +
    `Email: ${email || ""}\n` +
    `Scan: ${scanTypes}\n` +
    `Doctor Info :\n` +
    `Name: ${doctorName || ""}\n` +
    `Phone: ${doctorPhone || ""}\n` +
    `Email: ${doctorEmail || ""}\n` +
    `Clinic: ${clinicCode || ""}`;
  return text;
}

export function customerWhatsAppLink({ mobile, patientName, portalUrl, username, password }) {
  const text = buildCustomerMessage({ patientName, portalUrl, username, password });
  return `https://api.whatsapp.com/send?phone=${mobile}&text=${encode(text)}`;
}

export function scanWhatsAppLink(payload) {
  const text = buildScanMessage(payload);
  return `https://api.whatsapp.com/send?phone=${OPS_WHATSAPP_NUMBER}&text=${encode(text)}`;
}
