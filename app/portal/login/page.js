import { redirect } from "next/navigation";

// There is only one login page now (/login). This route stays in place so
// any old bookmarks, WhatsApp messages, or QR codes that point here still
// land somewhere real, but sends everyone straight to the single form.
export default function PortalLoginRedirect() {
  redirect("/login");
}
