import { isDefaultProject, isNotDefaultProject, type Project } from '../project';
export const sortProjects = (projects: Project[]) => [
  ...projects.filter(isDefaultProject),
  ...projects.filter(isNotDefaultProject)
    .sort((a, b) => a.name.localeCompare(b.name)),
];
