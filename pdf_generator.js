const html_to_pdf = require("html-pdf-node");

async function generatePdf(htmlContent, options = {}) {
  let file = { content: htmlContent };
  let pdfOptions = {
    format: "A4",
    printBackground: true,
    margin: { top: "1cm", right: "1cm", bottom: "1cm", left: "1cm" },
    ...options,
  };
  return await html_to_pdf.generatePdf(file, pdfOptions);
}

module.exports = { generatePdf };
