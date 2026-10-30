import { phoneForWhatsApp } from "./formatPhone";

// Ops number that receives the internal "Scan" message. Move to Settings/admin config in a later sprint.
const OPS_WHATSAPP_NUMBER = "+201288871871";

function encode(text) {
  return encodeURIComponent(text).replace(/%0A/g, "%0A");
}

// The keep-it-safe line is not a nicety. We do not keep a copy of anyone's
// password - only a one-way hash - so if the person loses the one they set
// themselves, nobody at the clinic can look it up. The only remedy is issuing
// a new temporary one, and the message has to say so plainly up front.
const KEEP_IT_SAFE =
  `Please change this password after your first login and keep your new one somewhere safe. ` +
  `We do not keep a copy of it, so if it is lost we can only issue you a new temporary one.`;

// One message, English then Arabic (Mohamed Said, 30 Oct 2026). Every account
// message is written in both languages so the clinic never has to send two,
// and the login details sit in the middle, shared by both.
const KEEP_IT_SAFE_AR =
  `برجاء تغيير كلمة المرور بعد أول دخول، واحتفظ بالجديدة في مكان آمن. ` +
  `إحنا مش بنحتفظ بنسخة منها، ولو ضاعت هنقدر نبعتلك كلمة مرور مؤقتة جديدة بس.`;
const FORGOT_EN = `Please log in with the password you created earlier. We do not keep a copy of it, so if you have forgotten it just reply here and we will send you a new temporary one.`;
const FORGOT_AR = `ادخل بكلمة المرور اللي عملتها قبل كده. إحنا مش بنحتفظ بنسخة منها، ولو نسيتها رد علينا هنا وهنبعتلك كلمة مرور مؤقتة جديدة.`;

// Copying a password out of WhatsApp meant copying the whole message, pasting
// it somewhere and cutting the password out (30 Oct 2026). Two fixes:
//  - a tap-to-login link: the login page reads the username and password from
//    the part after "#", fills the form and signs in. That part of a URL never
//    leaves the phone (browsers do not send it to the server), so the password
//    is not written into any server log.
//  - temporary passwords are digits only (migration 0130), alone on their
//    line, so WhatsApp makes them tappable and they copy on their own, the
//    same way the username (a phone number) already does.
//
// Layout (30 Oct 2026): the whole message in English, then the whole message
// in Arabic. Line-by-line mixing read badly on the phone.
function loginBase(portalUrl) {
  return String(portalUrl || "https://shscan.com").replace(/\/portal\/?$/, "").replace(/\/$/, "");
}
export function quickLoginUrl(portalUrl, username, password) {
  return `${loginBase(portalUrl)}/login#u=${encodeURIComponent(username)}&p=${encodeURIComponent(password)}`;
}
const SEP = "\n\n━━━━━━━━━━\n\n";

// intro: { en, ar } opening lines. Everything after is generated in each language.
function credentialsMessage(intro, { portalUrl, username, password }) {
  const link = quickLoginUrl(portalUrl, username, password);
  const en =
    `${intro.en}\n\n` +
    `👆 Tap to log in directly:\n${link}\n\n` +
    `Username:\n${username}\n\n` +
    `Password:\n${password}\n\n` +
    KEEP_IT_SAFE;
  const ar =
    `${intro.ar}\n\n` +
    `👆 اضغط للدخول مباشرة:\n${link}\n\n` +
    `اسم المستخدم:\n${username}\n\n` +
    `كلمة المرور:\n${password}\n\n` +
    KEEP_IT_SAFE_AR;
  return en + SEP + ar;
}
function linkMessage(intro, { portalUrl, username }, forgot = { en: FORGOT_EN, ar: FORGOT_AR }) {
  const en = `${intro.en}\n\nLogin: ${portalUrl}\nUsername: ${username}\n\n${forgot.en}`;
  const ar = `${intro.ar}\n\nالدخول: ${portalUrl}\nاسم المستخدم: ${username}\n\n${forgot.ar}`;
  return en + SEP + ar;
}

// Sent only when the person has no password of their own yet - either a brand
// new account, or one a staff member has just reset.
export function buildCustomerMessage({ patientName, portalUrl, username, password }) {
  return credentialsMessage({
    en: `Hi ${patientName}, thank you for visiting Al Shrooouk Scan & Lab.\nYour scans and reports will be sent directly to this number.`,
    ar: `أهلا ${patientName}، شكرا لزيارتك Al Shrooouk Scan & Lab.\nهتوصلك الأشعة والتقارير على الرقم ده مباشرة.`,
  }, { portalUrl, username, password });
}

// Sent to anyone who has already set their own password. Carries no password
// and triggers no reset - sending a fresh one here would silently invalidate
// the password they chose, locking them out of their own portal without any
// warning.
export function buildPortalLinkMessage({ patientName, portalUrl, username }) {
  return linkMessage({
    en: `Hi ${patientName}, thank you for visiting Al Shrooouk Scan & Lab.\nYour scans and reports are on your patient portal.`,
    ar: `أهلا ${patientName}، شكرا لزيارتك Al Shrooouk Scan & Lab.\nالأشعة والتقارير بتاعتك موجودة على البورتال.`,
  }, { portalUrl, username });
}

export function portalLinkWhatsAppLink({ mobile, patientName, portalUrl, username }) {
  const text = buildPortalLinkMessage({ patientName, portalUrl, username });
  return `https://api.whatsapp.com/send?phone=${phoneForWhatsApp(mobile)}&text=${encode(text)}`;
}

// Message bodies are archived in whatsapp_log for "did we actually send this".
// A temporary password must never go into that archive: the whole promise to
// the customer is that the clinic does not hold their password. The log keeps
// the shape of the message and drops only the secret.
export function redactPasswords(text) {
  return String(text || "")
    .replace(/^(\s*(?:Temporary )?Password:\s*).+$/gim, "$1[not stored]")
    .replace(/#u=[^\s]*/g, "#[not stored]")
    .replace(/((?:Password|كلمة المرور):\n)[^\n]+/g, "$1[not stored]");
}

export function buildScanMessage({ branch, patientName, mobile, email, scanTypes, doctorName, doctorPhone, doctorPhone2, doctorEmail, clinicCode }) {
  const doctorPhoneLine = doctorPhone2 ? `${doctorPhone || ""} / ${doctorPhone2}` : doctorPhone || "";
  const text =
    `Branch: ${branch} \n` +
    `Paitent Info :\n` +
    `Name: ${patientName}\n` +
    `Phone: ${mobile}\n` +
    `Email: ${email || ""}\n` +
    `Scan: ${scanTypes}\n` +
    `Doctor Info :\n` +
    `Name: ${doctorName || ""}\n` +
    `Phone: ${doctorPhoneLine}\n` +
    `Email: ${doctorEmail || ""}\n` +
    `Clinic: ${clinicCode || ""}`;
  return text;
}

export function customerWhatsAppLink({ mobile, patientName, portalUrl, username, password }) {
  const text = buildCustomerMessage({ patientName, portalUrl, username, password });
  // WhatsApp's click-to-chat only works reliably with digits-only + country code -
  // no "+", no leading zero. Stored numbers vary in raw format, so always normalize here.
  return `https://api.whatsapp.com/send?phone=${phoneForWhatsApp(mobile)}&text=${encode(text)}`;
}

export function scanWhatsAppLink(payload) {
  const text = buildScanMessage(payload);
  return `https://api.whatsapp.com/send?phone=${phoneForWhatsApp(OPS_WHATSAPP_NUMBER)}&text=${encode(text)}`;
}

export function buildVendorReportMessage({ vendorName, description, completedDate }) {
  const text =
    `Hi ${vendorName}, \n` +
    `Your requested report has been completed by Al Shrooouk Scan & Lab.\n\n` +
    `Request: ${description}\n` +
    `Completed: ${completedDate}\n\n` +
    `Thank you.`;
  return text;
}

export function vendorWhatsAppLink({ mobile, vendorName, description, completedDate }) {
  const text = buildVendorReportMessage({ vendorName, description, completedDate });
  return `https://api.whatsapp.com/send?phone=${phoneForWhatsApp(mobile)}&text=${encode(text)}`;
}

export function buildDoctorPortalLinkMessage({ doctorName, portalUrl, username }) {
  return linkMessage({
    en: `Hi Dr. ${doctorName}, this is your Al Shrooouk Scan & Lab referral portal.`,
    ar: `أهلا د. ${doctorName}، ده بورتال الإحالات بتاعك في Al Shrooouk Scan & Lab.`,
  }, { portalUrl, username });
}

export function buildEmployeePortalLinkMessage({ employeeName, portalUrl, username }) {
  return linkMessage({
    en: `Hi ${employeeName}, this is your Al Shrooouk Scan & Lab staff portal.`,
    ar: `أهلا ${employeeName}، ده بورتال الموظفين بتاعك في Al Shrooouk Scan & Lab.`,
  }, { portalUrl, username }, {
    en: `Please log in with the password you created earlier. If you have forgotten it, ask an administrator for a new temporary one.`,
    ar: `ادخل بكلمة المرور اللي عملتها قبل كده. لو نسيتها اطلب من الإدارة كلمة مرور مؤقتة جديدة.`,
  });
}

export function buildDoctorPortalMessage({ doctorName, portalUrl, username, password }) {
  return credentialsMessage({
    en: `Hi ${doctorName}, your Al Shrooouk Scan & Lab referral portal account is ready.\nFollow your referred patients' reports, raw data and balance there.`,
    ar: `أهلا ${doctorName}، حسابك على بورتال الإحالات في Al Shrooouk Scan & Lab جاهز.\nتقدر تتابع منه تقارير مرضاك والداتا والحساب.`,
  }, { portalUrl, username, password });
}

export function doctorPortalWhatsAppLink({ mobile, doctorName, portalUrl, username, password }) {
  const text = buildDoctorPortalMessage({ doctorName, portalUrl, username, password });
  return `https://api.whatsapp.com/send?phone=${phoneForWhatsApp(mobile)}&text=${encode(text)}`;
}

export function buildEmployeePortalMessage({ employeeName, portalUrl, username, password }) {
  return credentialsMessage({
    en: `Hi ${employeeName}, your Al Shrooouk Scan & Lab staff portal account is ready.`,
    ar: `أهلا ${employeeName}، حسابك على بورتال الموظفين في Al Shrooouk Scan & Lab جاهز.`,
  }, { portalUrl, username, password });
}

export function employeePortalWhatsAppLink({ mobile, employeeName, portalUrl, username, password }) {
  const text = buildEmployeePortalMessage({ employeeName, portalUrl, username, password });
  return `https://api.whatsapp.com/send?phone=${phoneForWhatsApp(mobile)}&text=${encode(text)}`;
}

// --- Patient message types (Greeting is buildCustomerMessage/customerWhatsAppLink above) ---

export function buildPatientReportMessage({ patientName, scanTypes, examDate }) {
  return (
    `Hi ${patientName}, \n` +
    `Your report for ${scanTypes} (${examDate}) is ready.\n` +
    `You can view and download it from your patient portal.`
  );
}
export function patientReportWhatsAppLink({ mobile, patientName, scanTypes, examDate }) {
  const text = buildPatientReportMessage({ patientName, scanTypes, examDate });
  return `https://api.whatsapp.com/send?phone=${phoneForWhatsApp(mobile)}&text=${encode(text)}`;
}

export function buildPatientInvoiceMessage({ patientName, invoiceNumber, amount }) {
  return (
    `Hi ${patientName}, \n` +
    `Your invoice ${invoiceNumber ? `#${invoiceNumber} ` : ""}for ${amount} EGP is attached/available on your patient portal.\n` +
    `Thank you for choosing Al Shrooouk Scan & Lab.`
  );
}
export function patientInvoiceWhatsAppLink({ mobile, patientName, invoiceNumber, amount }) {
  const text = buildPatientInvoiceMessage({ patientName, invoiceNumber, amount });
  return `https://api.whatsapp.com/send?phone=${phoneForWhatsApp(mobile)}&text=${encode(text)}`;
}

export function buildPatientRawDataMessage({ patientName, scanTypes, examDate }) {
  return (
    `Hi ${patientName}, \n` +
    `Your raw scan data for ${scanTypes} (${examDate}) has been uploaded and is available on your patient portal.`
  );
}
export function patientRawDataWhatsAppLink({ mobile, patientName, scanTypes, examDate }) {
  const text = buildPatientRawDataMessage({ patientName, scanTypes, examDate });
  return `https://api.whatsapp.com/send?phone=${phoneForWhatsApp(mobile)}&text=${encode(text)}`;
}

// Direct/empty - opens a chat with no pre-filled text, for free-form communication.
export function directWhatsAppLink(mobile) {
  return `https://api.whatsapp.com/send?phone=${phoneForWhatsApp(mobile)}`;
}

// --- Doctor message types (Greeting is buildDoctorPortalMessage/doctorPortalWhatsAppLink above) ---

export function buildDoctorReportMessage({ doctorName, patientName, scanTypes, examDate }) {
  return (
    `Hi ${doctorName}, \n` +
    `The report for your referred patient ${patientName} - ${scanTypes} (${examDate}) - is ready.\n` +
    `You can view it from your doctor portal.`
  );
}
export function doctorReportWhatsAppLink({ mobile, doctorName, patientName, scanTypes, examDate }) {
  const text = buildDoctorReportMessage({ doctorName, patientName, scanTypes, examDate });
  return `https://api.whatsapp.com/send?phone=${phoneForWhatsApp(mobile)}&text=${encode(text)}`;
}

export function buildDoctorRawDataMessage({ doctorName, patientName, scanTypes, examDate }) {
  return (
    `Hi ${doctorName}, \n` +
    `The raw data for your referred patient ${patientName} - ${scanTypes} (${examDate}) - has been uploaded and is available on your doctor portal.`
  );
}
export function doctorRawDataWhatsAppLink({ mobile, doctorName, patientName, scanTypes, examDate }) {
  const text = buildDoctorRawDataMessage({ doctorName, patientName, scanTypes, examDate });
  return `https://api.whatsapp.com/send?phone=${phoneForWhatsApp(mobile)}&text=${encode(text)}`;
}

// --- Client message types (external clients from Clients Management) ---

export function buildClientInvoiceMessage({ clientName, scanName, amount }) {
  return (
    `Hi ${clientName}, \n` +
    `Your invoice for "${scanName}"${amount ? ` (${amount} EGP)` : ""} is available.\n` +
    `Thank you for working with Al Shrooouk Scan & Lab.`
  );
}
export function clientInvoiceWhatsAppLink({ mobile, clientName, scanName, amount }) {
  const text = buildClientInvoiceMessage({ clientName, scanName, amount });
  return `https://api.whatsapp.com/send?phone=${phoneForWhatsApp(mobile)}&text=${encode(text)}`;
}

export function buildClientReportMessage({ clientName, scanName }) {
  return (
    `Hi ${clientName}, \n` +
    `Your report for "${scanName}" has been completed and is available in your client portal.`
  );
}
export function clientReportWhatsAppLink({ mobile, clientName, scanName }) {
  const text = buildClientReportMessage({ clientName, scanName });
  return `https://api.whatsapp.com/send?phone=${phoneForWhatsApp(mobile)}&text=${encode(text)}`;
}

// The doctor's counterpart to the patient Greeting: the portal link and their
// username. Deliberately no password - all 166 doctors already have accounts,
// and issuing a fresh one on a routine send would lock a doctor out of a
// portal they are already using. That exact fault was fixed on the patient
// side and there is no reason to repeat it here.
export function buildDoctorPortalLinkMessage2({ doctorName, portalUrl, username }) {
  return linkMessage({
    en: `Hi ${doctorName}, follow your referred patients (reports, raw data and balance) on your doctor portal.`,
    ar: `أهلا ${doctorName}، تقدر تتابع مرضاك (التقارير والداتا والحساب) على بورتال الدكتور.`,
  }, { portalUrl, username });
}
export function doctorPortalLinkWhatsAppLink({ mobile, doctorName, portalUrl, username }) {
  const text = buildDoctorPortalLinkMessage2({ doctorName, portalUrl, username });
  return `https://api.whatsapp.com/send?phone=${phoneForWhatsApp(mobile)}&text=${encode(text)}`;
}

// What this visit costs the referring clinic. Doctors are billed per visit
// against the clinic account, so the message names the patient and the scan
// rather than an invoice number the doctor has never seen.
export function buildDoctorVisitInvoiceMessage({ doctorName, patientName, scanTypes, examDate, amount }) {
  return (
    `Hi ${doctorName}, \n` +
    `Invoice for your referred patient ${patientName} - ${scanTypes} (${examDate}).\n` +
    `Amount: ${Number(amount || 0).toFixed(2)} EGP.\n` +
    `Your full balance is available on your doctor portal.`
  );
}
export function doctorVisitInvoiceWhatsAppLink({ mobile, doctorName, patientName, scanTypes, examDate, amount }) {
  const text = buildDoctorVisitInvoiceMessage({ doctorName, patientName, scanTypes, examDate, amount });
  return `https://api.whatsapp.com/send?phone=${phoneForWhatsApp(mobile)}&text=${encode(text)}`;
}

// --- Clients (white-label medical centres) ---------------------------------
// A client is a centre that sends scans here and shows the results to its own
// patients, so these read as a working relationship between two businesses -
// not as a clinic writing to a patient.

export function buildClientPortalMessage({ clientName, portalUrl, username, password }) {
  return credentialsMessage({
    en: `Hello ${clientName}, your Al Shrooouk Scan & Lab portal account is ready.`,
    ar: `أهلا ${clientName}، حسابك على بورتال Al Shrooouk Scan & Lab جاهز.`,
  }, { portalUrl, username, password });
}

// Sent to a client who already has an account. It carries no password, because
// resending a link should never disturb the one they are using.
export function buildClientPortalLinkMessage({ clientName, portalUrl, username }) {
  return linkMessage({
    en: `Hello ${clientName}, view your cases and results on your Al Shrooouk Scan & Lab portal.`,
    ar: `أهلا ${clientName}، تقدر تشوف الحالات والنتائج على بورتال Al Shrooouk Scan & Lab.`,
  }, { portalUrl, username });
}

export function clientPortalWhatsAppLink({ mobile, clientName, portalUrl, username, password }) {
  const text = buildClientPortalMessage({ clientName, portalUrl, username, password });
  return `https://api.whatsapp.com/send?phone=${phoneForWhatsApp(mobile)}&text=${encode(text)}`;
}

export function clientPortalLinkWhatsAppLink({ mobile, clientName, portalUrl, username }) {
  const text = buildClientPortalLinkMessage({ clientName, portalUrl, username });
  return `https://api.whatsapp.com/send?phone=${phoneForWhatsApp(mobile)}&text=${encode(text)}`;
}

// A report-ready message for clients already exists above (buildClientReportMessage).
