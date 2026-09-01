// product-interview.js — pure, non-technical discovery gate for /sc-build.
// The agent should infer fields from the user's existing message first, then call this only
// for genuinely missing product decisions. No infrastructure choices and no credentials.

function text(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s || null;
}

function clampQuestions(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(4, Math.trunc(n)));
}

function productInterview(input = {}) {
  const goal = text(input.goal);
  const primaryUser = text(input.primaryUser);
  const primaryAction = text(input.primaryAction);
  const mustHave = text(input.mustHave);
  const domain = text(input.domain);
  const existingProject = input.existingProject === true;
  const questionsAsked = clampQuestions(input.questionsAsked);

  const brief = {
    goal,
    primaryUser,
    primaryAction,
    mustHave,
    domain,
    existingProject,
  };

  const policy = {
    audience: 'non-technical',
    askOneAtATime: true,
    maxQuestionsBeforeFirstBuild: 3,
    chooseTechnicalDefaultsAutomatically: true,
    domainNotRequiredForFirstPreview: true,
    neverAskForTechnologyPreferenceByDefault: true,
  };

  if (existingProject) {
    return {
      readyToBuild: true,
      brief,
      nextQuestion: null,
      assumptions: ['Preserve the existing product architecture unless the user asks for a redesign or migration.'],
      policy,
      userFlow: {
        title: 'I have enough to continue',
        status: 'ready',
        message: 'I will inspect the existing app, improve what is needed, then prepare a working preview and publish it when ready.',
      },
      presentation: { defaultField: 'userFlow', technicalDetails: 'opt-in' },
    };
  }

  const questions = [
    !goal ? {
      id: 'goal',
      question: 'What would you like this app to help people do?',
      why: 'This tells me the result the app needs to deliver.',
    } : null,
    !primaryAction ? {
      id: 'primaryAction',
      question: 'What is the single most important thing a user should be able to do in the app?',
      why: 'I will make this the main flow of the first working version.',
    } : null,
    !primaryUser ? {
      id: 'primaryUser',
      question: 'Who will use the app?',
      why: 'This helps me choose the right screens and access levels.',
      choices: [
        { id: 'customers', label: 'Customers or the public' },
        { id: 'team', label: 'My team only' },
        { id: 'both', label: 'Customers and my team' },
        { id: 'other', label: 'Someone else' },
      ],
    } : null,
    !mustHave && questionsAsked < 3 ? {
      id: 'mustHave',
      question: 'Is there one thing that absolutely must work in the first version?',
      why: 'I will protect that requirement while simplifying everything else for a fast first version.',
      choices: [
        { id: 'no', label: 'No — use your best default' },
        { id: 'yes', label: 'Yes — I will describe it' },
      ],
    } : null,
  ].filter(Boolean);

  // After three product questions, start building with sensible defaults rather than turning
  // discovery into a requirements workshop. The agent can improve the product after preview.
  const nextQuestion = questionsAsked >= 3 ? null : (questions[0] || null);
  const readyToBuild = Boolean(goal && primaryAction && primaryUser && !nextQuestion);
  const forcedReady = questionsAsked >= 3 && Boolean(goal);

  if (readyToBuild || forcedReady) {
    return {
      readyToBuild: true,
      brief,
      nextQuestion: null,
      assumptions: [
        !primaryUser ? 'Choose the most likely user roles from the product goal.' : null,
        !primaryAction ? 'Choose the simplest useful primary flow from the product goal.' : null,
        !mustHave ? 'Ship a focused first version and refine it after the user sees the preview.' : null,
      ].filter(Boolean),
      policy,
      userFlow: {
        title: 'I have enough to build the first version',
        status: 'ready',
        message: 'I will choose sensible defaults, build the core experience, and show a working result before asking for more product decisions.',
        next: 'Build the first working version',
      },
      presentation: { defaultField: 'userFlow', technicalDetails: 'opt-in' },
    };
  }

  return {
    readyToBuild: false,
    brief,
    nextQuestion,
    assumptions: [],
    policy,
    userFlow: {
      title: 'One quick product question',
      status: 'needs-answer',
      question: nextQuestion.question,
      why: nextQuestion.why,
      choices: nextQuestion.choices || undefined,
      progress: `${Math.min(questionsAsked + 1, 3)}/3 maximum before the first build`,
    },
    presentation: { defaultField: 'userFlow', technicalDetails: 'opt-in' },
  };
}

module.exports = { productInterview };
