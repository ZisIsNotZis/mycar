# 打开 Blender GUI 并载入模型（供人工旋转/检查）
# 用法: blender --python scripts/blender-open.py -- <model.glb> [俯角°=18] [方位°=28]
# 说明：模型里车身是半透明外壳、内饰实心；这里补上灯光并把视口设成 MATERIAL。
import bpy, sys, os, math, mathutils

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if not argv:
    raise SystemExit('用法: blender --python scripts/blender-open.py -- <model.glb>')
glb = os.path.abspath(argv[0])
ELEV = math.radians(float(argv[1]) if len(argv) > 1 else 18.0)
AZIM = math.radians(float(argv[2]) if len(argv) > 2 else 28.0)

# 干净场景（去掉默认立方体）
bpy.ops.wm.read_homefile(use_empty=True)

# 灯光：环境 + 主光 + 补光（内部要能看清）
sc = bpy.context.scene
w = bpy.data.worlds.new('W'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.60, 0.68, 1.0)
w.node_tree.nodes['Background'].inputs[1].default_value = 1.15
_b = set(bpy.data.objects)
bpy.ops.object.light_add(type='SUN', location=(6, -6, 12))
sun = [o for o in bpy.data.objects if o not in _b][0]
sun.data.energy = 3.0; sun.data.angle = math.radians(10)
sun.rotation_euler = mathutils.Vector((0.5, 0.7, -1.0)).to_track_quat('-Z', 'Y').to_euler()
_b = set(bpy.data.objects)
bpy.ops.object.light_add(type='AREA', location=(-5, 5, 6))
fill = [o for o in bpy.data.objects if o not in _b][0]
fill.data.energy = 1200; fill.data.size = 10
fill.rotation_euler = mathutils.Vector((1.0, -0.9, -1.2)).to_track_quat('-Z', 'Y').to_euler()

# 载入模型
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=glb)
objs = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
lo = mathutils.Vector((1e9,) * 3); hi = -lo
for o in objs:
    for c in o.bound_box:
        v = o.matrix_world @ mathutils.Vector(c)
        lo = mathutils.Vector((min(lo[i], v[i]) for i in range(3)))
        hi = mathutils.Vector((max(hi[i], v[i]) for i in range(3)))
center = (lo + hi) / 2
radius = max((hi - lo).length / 2, 0.5)

# 渲染设置：按 F12 就能出图（有 N 卡走 OptiX）
sc.render.engine = 'CYCLES'; sc.cycles.samples = 64; sc.cycles.use_denoising = True
sc.view_settings.view_transform = 'Standard'
try:
    p = bpy.context.preferences.addons['cycles'].preferences
    p.compute_device_type = 'OPTIX'; p.get_devices()
    if any(d.type in ('OPTIX', 'CUDA') for d in p.devices):
        p.devices[0].use = True; sc.cycles.device = 'GPU'
except Exception:
    pass

# 视口：材质预览 + 摆到接近侧视的 3/4 视角
d = mathutils.Euler((0, 0, AZIM + math.pi / 2))
rot = mathutils.Euler((math.pi / 2 - ELEV, 0, AZIM + math.pi / 2)).to_quaternion()
for area in bpy.context.screen.areas if bpy.context.screen else []:
    if area.type == 'VIEW_3D':
        for space in area.spaces:
            if space.type == 'VIEW_3D':
                space.shading.type = 'MATERIAL'
                space.shading.studiolight_rotate_z = 0
                space.clip_start = 0.05; space.clip_end = 200
                r3d = space.region_3d
                r3d.view_location = center
                r3d.view_rotation = rot
                r3d.view_distance = radius / math.tan(math.radians(38) / 2) * 1.05
print(f'[open] 已载入 {os.path.basename(glb)}：{len(objs)} 个网格，'
      f'{radius*2:.2f}m 包围球 · 对象数 {len(bpy.data.objects)}')
