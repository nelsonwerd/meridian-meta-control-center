import { generateDataset, type Dataset } from './generate'

let _dataset: Dataset | null = null

/** Lazily build the deterministic demo dataset once per session. */
export function getDataset(): Dataset {
  if (!_dataset) _dataset = generateDataset()
  return _dataset
}
