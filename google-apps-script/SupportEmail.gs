/**
 * ElectroStock Support email sender.
 * Deploy as a Web app: Execute as "Me"; access "Anyone".
 * Set Script Properties:
 *   SUPPORT_EMAIL = electrostock.zyx@gmail.com
 *   SUPPORT_WEBHOOK_SECRET = a long random secret also saved in Supabase Edge Function secrets.
 */
function doPost(e) {
  try {
    const props = PropertiesService.getScriptProperties();
    const expectedSecret = props.getProperty("SUPPORT_WEBHOOK_SECRET");
    if (!expectedSecret) return output({ success: false, error: "Sender is not configured." });
    const payload = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (!payload.secret || payload.secret !== expectedSecret) {
      return output({ success: false, error: "Unauthorized." });
    }

    const supportEmail = props.getProperty("SUPPORT_EMAIL") || "electrostock.zyx@gmail.com";
    const to = String(payload.to || "").trim();
    const subject = String(payload.subject || "ElectroStock Support").slice(0, 250);
    const plainBody = String(payload.plainBody || "You have a new ElectroStock Support notification.");
    const htmlBody = String(payload.htmlBody || "");
    const replyTo = String(payload.replyTo || supportEmail).trim();

    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return output({ success: false, error: "A valid recipient email is required." });
    }
    const options = { htmlBody: htmlBody, name: "ElectroStock Support" };
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo)) options.replyTo = replyTo;
    GmailApp.sendEmail(to, subject, plainBody, options);
    return output({ success: true });
  } catch (err) {
    console.error(err);
    return output({ success: false, error: "Gmail could not send the message." });
  }
}

function output(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
