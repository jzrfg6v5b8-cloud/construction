import { randomBytes } from "node:crypto";
import { getDb } from "@/lib/db/client";

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${randomBytes(8).toString("hex")}`;

export type ProductInput = {
  sku: string; name: string; category: string; widthMm?: number | null; depthMm?: number | null;
  heightMm?: number | null; materialCode?: string | null; supplier?: string | null; unit?: string;
  unitCost: number; unitPrice: number; dimensionsVerified?: boolean; sourceAssetId?: string | null;
};
export type BomInput = { sku: string; name: string; quantity: number; unit: string; unitCost: number; unitPrice: number; materialCode?: string | null; roomCode?: string | null; productId?: string | null };

export function listProducts(projectId: string) {
  return getDb().sqlite.prepare("SELECT * FROM products WHERE project_id = ? ORDER BY sku").all(projectId) as Record<string, unknown>[];
}
export function upsertProduct(projectId: string, input: ProductInput) {
  const stamp = now();
  getDb().sqlite.prepare(`INSERT INTO products
    (id,project_id,sku,name,category,width_mm,depth_mm,height_mm,material_code,supplier,unit,unit_cost,unit_price,dimensions_verified,source_asset_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,sku) DO UPDATE SET
    name=excluded.name,category=excluded.category,width_mm=excluded.width_mm,depth_mm=excluded.depth_mm,height_mm=excluded.height_mm,
    material_code=excluded.material_code,supplier=excluded.supplier,unit=excluded.unit,unit_cost=excluded.unit_cost,unit_price=excluded.unit_price,
    dimensions_verified=excluded.dimensions_verified,source_asset_id=excluded.source_asset_id,updated_at=excluded.updated_at`)
    .run(id("prd"),projectId,input.sku,input.name,input.category,input.widthMm??null,input.depthMm??null,input.heightMm??null,input.materialCode??null,input.supplier??null,input.unit??"piece",input.unitCost,input.unitPrice,input.dimensionsVerified?1:0,input.sourceAssetId??null,stamp,stamp);
  return getDb().sqlite.prepare("SELECT * FROM products WHERE project_id=? AND sku=?").get(projectId,input.sku);
}
export function replaceBom(projectId: string, sourceVersion: string, items: BomInput[]) {
  const db=getDb().sqlite; const tx=db.transaction(()=>{ db.prepare("DELETE FROM bom_items WHERE project_id=?").run(projectId); const stmt=db.prepare(`INSERT INTO bom_items (id,project_id,product_id,sku,name,quantity,unit,unit_cost,unit_price,material_code,room_code,source_version,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`); for(const item of items) stmt.run(id("bom"),projectId,item.productId??null,item.sku,item.name,item.quantity,item.unit,item.unitCost,item.unitPrice,item.materialCode??null,item.roomCode??null,sourceVersion,now()); }); tx(); return listBom(projectId);
}
export function listBom(projectId:string){ return getDb().sqlite.prepare("SELECT * FROM bom_items WHERE project_id=? ORDER BY sku").all(projectId) as Array<Record<string,unknown>>; }
export function createQuote(projectId:string,input:{version:string;currency?:string;designFee?:number;discount?:number;tax?:number}){ const bom=listBom(projectId); const subtotal=bom.reduce((s,r)=>s+Number(r.quantity)*Number(r.unit_price),0); const designFee=input.designFee??0,discount=input.discount??0,tax=input.tax??0,total=subtotal+designFee+tax-discount,stamp=now(); getDb().sqlite.prepare(`INSERT INTO quotes (id,project_id,version,currency,status,subtotal,design_fee,discount,tax,total,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,version) DO UPDATE SET currency=excluded.currency,subtotal=excluded.subtotal,design_fee=excluded.design_fee,discount=excluded.discount,tax=excluded.tax,total=excluded.total,updated_at=excluded.updated_at`).run(id("quo"),projectId,input.version,input.currency??"HKD","DRAFT",subtotal,designFee,discount,tax,total,stamp,stamp); return getLatestQuote(projectId); }
export function getLatestQuote(projectId:string){ return getDb().sqlite.prepare("SELECT * FROM quotes WHERE project_id=? ORDER BY updated_at DESC LIMIT 1").get(projectId) as Record<string,unknown>|undefined; }
