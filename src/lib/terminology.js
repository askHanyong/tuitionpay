// Central terminology map — display labels only.
// Database table/column names never change; only what appears on screen.
export const TERMINOLOGY = {
  tutor: {
    student: "Student",
    students: "Students",
    subject: "Subject",
    subjects: "Subjects",
    lesson: "Lesson",
    lessons: "Lessons",
  },
  practitioner: {
    student: "Client",
    students: "Clients",
    subject: "Service",
    subjects: "Services",
    lesson: "Session",
    lessons: "Sessions",
  },
};

// Returns the terminology object for the given user_type.
// Falls back to tutor terminology for null / unknown values.
export function getTerms(userType) {
  return TERMINOLOGY[userType] ?? TERMINOLOGY.tutor;
}
