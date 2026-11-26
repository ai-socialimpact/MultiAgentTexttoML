export type DossierPersonaId =
  | 'school_student'
  | 'college_graduate'
  | 'ngo_leader'
  | 'data_scientist';

export interface DossierPersonaConfig {
  id: DossierPersonaId;
  label: string;
  shortLabel: string;
  badge: string;
  description: string;
  instructionPrompt: string;
}

export const DOSSIER_PERSONAS: DossierPersonaConfig[] = [
  {
    id: 'school_student',
    label: 'School Student Intern at NGO (Simplest)',
    shortLabel: 'School Student Intern (NGO)',
    badge: 'School Student Intern (NGO)',
    description:
      'Everyday words, warm analogies (community clubs, events, recipes), short sentences, and zero confusing math jargon.',
    instructionPrompt:
      'Target Audience: High-school student serving as an intern at an NGO. Tone must be extremely easy to understand, warm, intuitive, and encouraging. Avoid confusing formulas or statistical jargon. Explain findings using relatable everyday analogies (such as organizing a school club, community drive, or recipe) and clearly show how the numbers help the NGO serve people better.'
  },
  {
    id: 'college_graduate',
    label: 'College Graduate NGO Volunteer',
    shortLabel: 'College Grad Volunteer (NGO)',
    badge: 'College Graduate Volunteer (NGO)',
    description:
      'Clear, structured explanations covering percentages, trends, and practical reasoning tailored for volunteer work.',
    instructionPrompt:
      'Target Audience: College graduate volunteering with an NGO. Explain findings clearly, practically, and logically without assuming advanced statistical or machine learning training. Translate key metrics (percentages, averages, comparisons, and drivers) into concrete volunteer actions and program insights.'
  },
  {
    id: 'ngo_leader',
    label: 'NGO Program Leader',
    shortLabel: 'NGO Program Leader',
    badge: 'NGO Program Leader',
    description:
      'Mission-focused summary highlighting beneficiary reach, resource allocation, operational risks, and donor-ready clarity.',
    instructionPrompt:
      'Target Audience: NGO Program Leader / Director. Frame findings around mission impact, beneficiary reach, operational bottlenecks, staff and volunteer allocation, program risks, and donor-ready strategic clarity. Lead with decision-ready takeaways and practical rollout priorities.'
  },
  {
    id: 'data_scientist',
    label: 'Data Scientist',
    shortLabel: 'Data Scientist',
    badge: 'Data Scientist',
    description:
      'Rigorous statistical metrics, machine learning hyperparameters, distributions, feature importances, and validation caveats.',
    instructionPrompt:
      'Target Audience: Professional Data Scientist. Provide deep statistical and machine learning rigor: exact metrics (AUC-ROC, Log-Loss, F1, MSE), dataset distributions, tensor shapes, gradient considerations, feature importances, and production validation.'
  }
];
