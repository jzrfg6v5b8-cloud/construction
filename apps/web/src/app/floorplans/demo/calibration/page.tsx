import { redirect } from "next/navigation";

export default function LegacyCalibrationRedirect() {
  redirect("/projects/demo/calibration");
}
