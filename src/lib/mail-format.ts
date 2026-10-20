// Only exact, attribute-free b/i tags from the template are interpreted.
// Participant values are always escaped and never parsed as markup.
export function escapeMailHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}
export function formatMailBody(
  template: string,
  values: Record<string, string> = {},
  panelUrl = "",
) {
  const stack: string[] = [];
  const text = (value: string) => {
    let html = escapeMailHtml(value);
    if (panelUrl && /^https:\/\//.test(panelUrl)) {
      const url = escapeMailHtml(panelUrl);
      html = html.replaceAll(url, `<a href="${url}">${url}</a>`);
    }
    return html.replace(/\r?\n/g, "<br>");
  };
  const html = template
    .split(/(<\/?[bi]>|\{\{\w+\}\})/gi)
    .map((part) => {
      if (/^<[bi]>$/i.test(part)) {
        const tag = part[1].toLowerCase();
        stack.push(tag);
        return `<${tag}>`;
      }
      if (/^<\/[bi]>$/i.test(part)) {
        const tag = part[2].toLowerCase();
        if (stack.at(-1) === tag) {
          stack.pop();
          return `</${tag}>`;
        }
        return text(part);
      }
      const match = /^\{\{(\w+)\}\}$/.exec(part);
      return text(match ? (values[match[1]] ?? part) : part);
    })
    .join("");
  return (
    html +
    stack
      .reverse()
      .map((tag) => `</${tag}>`)
      .join("")
  );
}
