export const BUSINESS_DETAILS = {
  name: "A-Matrix",
  salesEmail: "sales@a-matrix.ng",
  telephonePrimary: "+234 706 917 6001",
  telephoneSecondary: "+234 1 453 6335",
  office:
    "445 Herbert Macaulay Street, Bio-Vaccine Compound, Yaba, Lagos State, Nigeria",
  hours: {
    weekdays: "Monday to Friday, 9:00 a.m.–5:00 p.m.",
    saturday: "Saturday, 9:00 a.m.–2:00 p.m.",
    sunday: "Sunday closed",
  },
  hoursShort: "Weekdays 9:00–17:00; Saturday 9:00–14:00 WAT.",
} as const;

export const BUSINESS_HOURS_SUMMARY = [
  BUSINESS_DETAILS.hours.weekdays,
  BUSINESS_DETAILS.hours.saturday,
  BUSINESS_DETAILS.hours.sunday,
].join("; ");
