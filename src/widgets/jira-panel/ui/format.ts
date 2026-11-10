import { escHtml } from "../../../shared/lib/html";
export function formatJiraDate(dateStr: string) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 60) return mins + "m ago";
  if (hours < 24) return hours + "h ago";
  if (days < 30) return days + "d ago";
  return d.toLocaleDateString();
}

// Render Jira wiki markup (images, videos, links, bare URLs) as HTML.
// `attachments` maps filename -> URL, used to resolve !file! image/video markup.
export function formatJiraWikiText(
  text: string,
  attachments: Record<string, string>,
) {
  attachments = attachments || {};
  // Simple formatting: escape HTML first, then replace wiki markup
  let html = escHtml(text).replace(/\n/g, "<br>");
  // Replace Jira wiki image markup: !filename|params! or !filename!
  html = html.replace(
    /!([^|!]+?)(?:\|[^!]*)?!/g,
    function (match: string, filename: string) {
      const url = attachments[filename];
      if (!url) return match;
      const ext = (filename.split(".").pop() || "").toLowerCase();
      if (ext === "mp4" || ext === "webm" || ext === "ogg" || ext === "mov") {
        return (
          '<video src="' +
          escHtml(url) +
          '" controls class="gl-jira-sidebar-video"></video>'
        );
      }
      return (
        '<img src="' +
        escHtml(url) +
        '" alt="' +
        escHtml(filename) +
        '" class="gl-jira-sidebar-img">'
      );
    },
  );
  // Replace Jira wiki links: [text|url] or [url]
  html = html.replace(
    /\[([^|\]\n]+)\|([^\]\n]+?)(?:\|[^\]\n]*)?\]/g,
    function (_match, text, url) {
      return (
        '<a href="' +
        escHtml(url) +
        '" target="_blank" class="gl-jira-sidebar-inline-link">' +
        text +
        "</a>"
      );
    },
  );
  html = html.replace(/\[(https?:\/\/[^\]\n]+)\]/g, function (_match, url) {
    return (
      '<a href="' +
      escHtml(url) +
      '" target="_blank" class="gl-jira-sidebar-inline-link">' +
      url +
      "</a>"
    );
  });
  // Auto-link bare URLs not already inside href or <a> tags
  html = html.replace(
    /(^|[^"=])(https?:\/\/[^\s<]+)/g,
    function (_match, prefix, url) {
      return (
        prefix +
        '<a href="' +
        url +
        '" target="_blank" class="gl-jira-sidebar-inline-link">' +
        url +
        "</a>"
      );
    },
  );
  return html;
}
