import { z } from "zod";
import { accessErrorResponse, requireOwnedProject } from "@/lib/auth/project-access";
import { createDeepSeekBusinessProvider } from "@/lib/providers/mock-deepseek";
import { FloorPlanOCRResultSchema, ProductOCRResultSchema, StructuredVisionResultSchema } from "@/lib/providers/business-llm";

const RequestSchema=z.discriminatedUnion("kind",[
  z.object({kind:z.literal("floorplan"),input:FloorPlanOCRResultSchema}),
  z.object({kind:z.literal("product"),input:ProductOCRResultSchema}),
  z.object({kind:z.literal("vision"),input:StructuredVisionResultSchema}),
]);

export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  const {id}=await context.params;
  try{
    await requireOwnedProject(id);
    const body=RequestSchema.parse(await request.json());
    const provider=createDeepSeekBusinessProvider();
    const result=body.kind==="floorplan"
      ? await provider.reconcileFloorPlanMeasurements(body.input)
      : body.kind==="product"
        ? await provider.classifyProcurementItem(body.input)
        : await provider.extractStructuredBusinessData(body.input);
    return Response.json({projectId:id,provider:process.env.DEEPSEEK_API_KEY?"deepseek":"mock",reviewStatus:"HUMAN_REVIEW_REQUIRED",result});
  }catch(error){const access=accessErrorResponse(error);if(access)return access;return Response.json({error:error instanceof Error?error.message:"AI_RECONCILIATION_FAILED"},{status:400});}
}
