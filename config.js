// All numbers you may want to change live here.
// Canva does not publish a limit for its website, so these are safe guesses.
export const DEFAULTS = {
  folder: 'Canva Templates', // folder inside your Downloads folder
  format: 'pptx', // fixed: every file is PowerPoint
  minWaitSec: 20, // random wait between templates (lowest)
  maxWaitSec: 45, // random wait between templates (highest)
  perHour: 40, // templates per hour
  perDay: 100, // templates per day (start with 50 to 100 in the first week)
  perZip: 50, // templates in one ZIP file
  maxAttempts: 3, // tries per template before it is marked failed
  jobTimeoutSec: 120, // a template with no progress for this long is tried again
};

// Rough time for one template, used only for the finish estimate in the popup.
export const WORK_SEC_PER_JOB = 25;
