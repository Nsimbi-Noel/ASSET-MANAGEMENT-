const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const PAGE_MARGIN = 28;
const ROW_HEIGHT = 16;
const HEADER_HEIGHT = 18;
const FONT_SIZE = 7;
const HEADER_FONT_SIZE = 7.5;
const TITLE_FONT_SIZE = 15;

/**
 * Generates a PDF buffer for a tabular report (e.g. the Asset Register).
 * Uses pdf-lib, a pure-JS PDF library with no native/Chromium dependency,
 * so it works reliably in any Node environment without extra system setup.
 *
 * @param {Object} report
 * @param {string} report.title - Report title shown at the top of the PDF.
 * @param {Buffer|null} report.logoBuffer - Optional JPEG logo image buffer.
 * @param {string[]} report.columns - Column headers, in order.
 * @param {string[]} report.columnKeys - Row object keys matching each column, in order.
 * @param {Object[]} report.rows - Row data objects.
 * @param {boolean} [landscape=true] - Page orientation.
 * @returns {Promise<Buffer>}
 */
async function generateTablePdf(report, landscape = true) {
  const { title, logoBuffer, columns, columnKeys, rows } = report;

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageSize = landscape ? [841.89, 595.28] : [595.28, 841.89]; // A4
  let logoImage = null;
  if (logoBuffer) {
    try {
      logoImage = await pdfDoc.embedJpg(logoBuffer);
    } catch (e) {
      try {
        logoImage = await pdfDoc.embedPng(logoBuffer);
      } catch (e2) {
        logoImage = null;
      }
    }
  }

  const colCount = columns.length;

  function newPage() {
    const page = pdfDoc.addPage(pageSize);
    const { width, height } = page.getSize();
    const usableWidth = width - PAGE_MARGIN * 2;
    let cursorY = height - PAGE_MARGIN;

    if (logoImage) {
      const logoWidth = 60;
      const logoHeight = (logoImage.height / logoImage.width) * logoWidth;
      page.drawImage(logoImage, {
        x: width / 2 - logoWidth / 2,
        y: cursorY - logoHeight,
        width: logoWidth,
        height: logoHeight
      });
      cursorY -= logoHeight + 8;
    }

    const titleWidth = boldFont.widthOfTextAtSize(title, TITLE_FONT_SIZE);
    page.drawText(title, {
      x: width / 2 - titleWidth / 2,
      y: cursorY - TITLE_FONT_SIZE,
      size: TITLE_FONT_SIZE,
      font: boldFont,
      color: rgb(0.039, 0.267, 0.557)
    });
    cursorY -= TITLE_FONT_SIZE + 16;

    return { page, width, height, usableWidth, cursorY };
  }

  function drawTableHeader(page, usableWidth, y) {
    const colWidth = usableWidth / colCount;

    page.drawRectangle({
      x: PAGE_MARGIN,
      y: y - HEADER_HEIGHT,
      width: usableWidth,
      height: HEADER_HEIGHT,
      color: rgb(0.949, 0.949, 0.949)
    });

    columns.forEach((col, i) => {
      const x = PAGE_MARGIN + i * colWidth + 3;
      page.drawText(truncateToWidth(col, boldFont, HEADER_FONT_SIZE, colWidth - 6), {
        x,
        y: y - HEADER_HEIGHT + 6,
        size: HEADER_FONT_SIZE,
        font: boldFont,
        color: rgb(0.1, 0.12, 0.16)
      });
    });

    drawGridLines(page, usableWidth, y, HEADER_HEIGHT, colWidth);
    return y - HEADER_HEIGHT;
  }

  function drawGridLines(page, usableWidth, y, rowH, colWidth) {
    for (let i = 0; i <= colCount; i++) {
      const x = PAGE_MARGIN + i * colWidth;
      page.drawLine({
        start: { x, y },
        end: { x, y: y - rowH },
        thickness: 0.5,
        color: rgb(0.85, 0.85, 0.85)
      });
    }
    page.drawLine({
      start: { x: PAGE_MARGIN, y },
      end: { x: PAGE_MARGIN + usableWidth, y },
      thickness: 0.5,
      color: rgb(0.85, 0.85, 0.85)
    });
    page.drawLine({
      start: { x: PAGE_MARGIN, y: y - rowH },
      end: { x: PAGE_MARGIN + usableWidth, y: y - rowH },
      thickness: 0.5,
      color: rgb(0.85, 0.85, 0.85)
    });
  }

  function truncateToWidth(text, fontRef, size, maxWidth) {
    let str = String(text);
    if (fontRef.widthOfTextAtSize(str, size) <= maxWidth) return str;
    while (str.length > 1 && fontRef.widthOfTextAtSize(str + '..', size) > maxWidth) {
      str = str.slice(0, -1);
    }
    return str + '..';
  }

  let { page, width, height, usableWidth, cursorY } = newPage();
  const bottomLimit = PAGE_MARGIN + 20;
  cursorY = drawTableHeader(page, usableWidth, cursorY);

  rows.forEach((row) => {
    if (cursorY - ROW_HEIGHT < bottomLimit) {
      const next = newPage();
      page = next.page;
      width = next.width;
      height = next.height;
      usableWidth = next.usableWidth;
      cursorY = drawTableHeader(page, usableWidth, next.cursorY);
    }

    const colWidth = usableWidth / colCount;
    columnKeys.forEach((key, i) => {
      const raw = row[key] === null || row[key] === undefined ? '-' : String(row[key]);
      const x = PAGE_MARGIN + i * colWidth + 3;
      page.drawText(truncateToWidth(raw, font, FONT_SIZE, colWidth - 6), {
        x,
        y: cursorY - ROW_HEIGHT + 5,
        size: FONT_SIZE,
        font,
        color: rgb(0.2, 0.2, 0.2)
      });
    });

    drawGridLines(page, usableWidth, cursorY, ROW_HEIGHT, colWidth);
    cursorY -= ROW_HEIGHT;
  });

  // Footer on the final page
  const footerText = `Generated by URSB Asset Management System on ${new Date().toLocaleDateString()}`;
  const footerWidth = font.widthOfTextAtSize(footerText, 8);
  page.drawText(footerText, {
    x: width / 2 - footerWidth / 2,
    y: PAGE_MARGIN - 12,
    size: 8,
    font,
    color: rgb(0.4, 0.4, 0.4)
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

module.exports = { generateTablePdf };
