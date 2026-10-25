// Hook Mixer — міст між сайтом і твоєю папкою на Google Drive.
// Встав цей код на script.google.com і опублікуй як Web app (інструкція в README.md).
// Скрипт віддає ТІЛЬКИ файли всередині головної папки, решта твого Drive недоступна.

const ROOT_FOLDER_ID = '1yoCiuF8Mm6rOSPf482WToMDBtfQIludH';

function doGet(e) {
  let out;
  try {
    const p = e.parameter;
    if (p.action === 'list') {
      const folder = DriveApp.getFolderById(p.id || ROOT_FOLDER_ID);
      if (!isInsideRoot(folder)) throw new Error('Папка поза головною папкою');
      const files = [];
      const subs = folder.getFolders();
      while (subs.hasNext()) {
        const f = subs.next();
        files.push({ id: f.getId(), name: f.getName(), mimeType: 'application/vnd.google-apps.folder' });
      }
      const list = folder.getFiles();
      while (list.hasNext()) {
        const f = list.next();
        files.push({ id: f.getId(), name: f.getName(), mimeType: f.getMimeType(), size: f.getSize() });
      }
      out = { files: files };
    } else if (p.action === 'file') {
      const f = DriveApp.getFileById(p.id);
      if (!isInsideRoot(f)) throw new Error('Файл поза головною папкою');
      const type = f.getMimeType();
      if (type === MimeType.GOOGLE_DOCS) {
        out = { text: DocumentApp.openById(p.id).getBody().getText() };
      } else {
        out = { base64: Utilities.base64Encode(f.getBlob().getBytes()), mimeType: type };
      }
    } else {
      out = { ok: true, message: 'Hook Mixer script працює' };
    }
  } catch (err) {
    out = { error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// перевіряє, що файл або папка лежить всередині ROOT_FOLDER_ID (до 6 рівнів вкладеності)
function isInsideRoot(item) {
  if (item.getId && item.getId() === ROOT_FOLDER_ID) return true;
  let level = [item];
  for (let depth = 0; depth < 6 && level.length; depth++) {
    const next = [];
    for (const it of level) {
      const parents = it.getParents();
      while (parents.hasNext()) {
        const parent = parents.next();
        if (parent.getId() === ROOT_FOLDER_ID) return true;
        next.push(parent);
      }
    }
    level = next;
  }
  return false;
}
