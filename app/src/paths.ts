/** Resolve all local resources beneath Vite's deployment base. */
export const appPath = (path: string) => import.meta.env.BASE_URL + path.replace(/^\/+/, '');
export const rawSourceUrl = (sourceFile: string) => appPath('raw/' + sourceFile.replace(/^data\/raw\//, ''));
