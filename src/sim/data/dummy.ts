import dummyJson from "../../../data/dummy.json";
import { type DummyData, dummyDataSchema } from "../../../data/schemas/dummy";

/** Parse untrusted dummy data; throws a descriptive error when invalid. */
export function parseDummyData(raw: unknown): DummyData {
  const result = dummyDataSchema.safeParse(raw);
  if (!result.success) throw new Error(`invalid data/dummy.json: ${result.error.message}`);
  return result.data;
}

export const DUMMY_DATA: DummyData = parseDummyData(dummyJson);
