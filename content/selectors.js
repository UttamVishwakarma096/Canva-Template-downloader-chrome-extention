// How the extension finds things on Canva's pages. Canva changes its website
// often: when a step fails with "Canva page may have changed", fix it HERE.
//
// Buttons are found by their visible words or aria-label, never by CSS class
// names (Canva's class names are random). If your Canva is not in English,
// add the words in your language to each list.
self.CANVA_SELECTORS = {
  // Elements that can be clicked.
  clickable: 'button, [role="button"], a[href], [role="menuitem"], [role="option"], [role="tab"], [role="link"]',

  // Step 1, on the template page.
  useTemplate: ['Use this template', 'Customize this template', 'Customise this template', 'Use template'],

  // Signs that the primary CTA on a template page requires Canva Pro / Premium
  proCtaButtons: [
    'upgrade to canva pro',
    'try canva pro',
    'get canva pro',
    'unlock with canva pro',
    'unlock this template',
    'start free pro trial',
    'start free trial',
    'try pro free',
    'buy this template',
    'switch to canva pro',
  ],

  // Steps 2 to 5, in the editor.
  share: ['Share'],
  download: ['Download'],
  fileTypeLabel: ['File type', 'File type:'], // aria-label or label of the file type menu
  fileTypeValues: /^(png|jpg|jpeg|pdf|svg|mp4|gif|pptx|microsoft powerpoint)\b/i, // e.g. "PDF Suggested" // text shown on the menu
  pptxOption: ['PPTX', 'Microsoft PowerPoint', 'PowerPoint', 'Microsoft PowerPoint Document'],
  pptxSelected: /pptx|powerpoint/i,
  finalDownload: ['Download'],

  // Signs that something needs you or is Pro/Premium inside dialogs or panels. Lower case.
  proSigns: [
    'upgrade to canva pro',
    'try canva pro',
    'get canva pro',
    'start your free pro trial',
    'start free pro trial',
    'try pro free',
    'unlock this template',
    'unlock with canva pro',
    'included with canva pro',
    'canva pro template',
    'premium template',
    'pay and download',
    'download with canva pro',
    'buy this template',
    'contains premium elements',
    'contains paid elements',
    'premium content',
    'premium images',
    'remove watermarks',
    'switch to canva pro',
    'go pro',
  ],
  captchaSigns: ['verify you are human', 'are you a robot', 'security check'],
  slowDownSigns: ['too many requests', 'slow down'],

  // Page addresses.
  loginPath: /^\/(login|signup)\b/,
  editorPath: /^\/design\/[^/?#]+(\/[^/?#]+)?\/edit/,
  templatePath: /^\/templates\/EA[A-Za-z0-9_-]{6,}/,
  // A template id looks like EAFhHM4bhZE. Links may be /templates/EAF.../,
  // a translated path like /es_es/plantillas/EAF.../, or ?template=EAF...
  templateIdInPath: /\/(EA[A-Za-z0-9_-]{6,})\/?$/,
  templateIdInQuery: ['template', 'templateId'],
  // The box around one template picture on the search page (/s/templates).
  cardSelector: '[role="group"][aria-label^="Preview"], [role="group"]',

  // Seconds to wait for one button before giving up.
  stepTimeoutSec: 15,
  editorLoadSec: 60,
};
