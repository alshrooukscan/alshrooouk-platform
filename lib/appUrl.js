// The one place the platform's public-facing address is defined. Every
// WhatsApp message, portal link, and shared receipt URL should import this
// rather than deriving it from window.location.origin.
//
// window.location.origin reflects whatever domain the STAFF MEMBER currently
// has open - alshroouk-scan.vercel.app, the test alias, or shscan.com - not
// a fixed address. A staff member with an old bookmark or an old tab open
// would silently send patients and doctors a link to the wrong domain, with
// no error and no way to notice from the sending side. This is exactly what
// happened after the shscan.com migration: the domain itself changed, but
// every message-composing screen kept reading window.location.origin, so
// outbound links kept reflecting whichever address staff happened to be
// browsing rather than the one address the clinic actually wants patients
// and doctors using.
//
// Update this single constant if the domain ever changes again - nothing
// else in the codebase should hardcode or derive the platform URL itself.
export const APP_URL = "https://shscan.com";
