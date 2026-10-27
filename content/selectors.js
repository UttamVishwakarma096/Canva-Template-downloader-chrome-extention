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
    'upgrade to pro',
    'try canva pro',
    'try pro',
    'get canva pro',
    'unlock with canva pro',
    'unlock with pro',
    'unlock this template',
    'start free pro trial',
    'start free trial',
    'start my free trial',
    'claim my free trial',
    'try pro free',
    'try canva pro for free',
    'buy this template',
    'switch to canva pro',
    'subscribe to canva pro',
    'pay and download',
    'download with canva pro',
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
    'upgrade to pro',
    'try canva pro',
    'try pro',
    'get canva pro',
    'start your free pro trial',
    'start free pro trial',
    'start your free trial',
    'start free trial',
    'start my free trial',
    'claim my free trial',
    'start 30-day free trial',
    'start trial',
    'try pro free',
    'try it free for 30 days',
    'try canva pro for free',
    'unlock this template',
    'unlock with canva pro',
    'unlock with pro',
    'included with canva pro',
    'canva pro template',
    'premium template',
    'paid template',
    'pay and download',
    'download with canva pro',
    'buy this template',
    'contains premium elements',
    'contains paid elements',
    'premium content',
    'premium images',
    'remove watermarks',
    'switch to canva pro',
    'subscribe to canva pro',
    'requires canva pro',
    'only for canva pro',
    'canva pro required',
    'pro feature',
    'pro subscription',
    'go pro',
    'cancel anytime',
    'unlock all templates',
  ],
  captchaSigns: ['verify you are human', 'are you a robot', 'security check'],
  slowDownSigns: ['too many requests', 'slow down'],

  // Page addresses.
  loginPath: /^\/(login|signup)\b/,
  editorPath: /^\/design\b/,
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
