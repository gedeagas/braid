// Route shim: the source-control screen lives in `@/source-control` so its
// pieces (BranchCard, FileRow, DiffSheet, helpers) stay under the 450-line
// module limit. Expo Router only needs the default export here.
export { default } from '@/source-control/SourceControlScreen';
