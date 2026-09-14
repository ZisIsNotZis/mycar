# 无头渲染：把一批 .glb 渲成展示图（Blender 4.x，Cycles）
# 用法: blender -b -P scripts/blender-render.py -- <glb目录> <png目录> [视图数=2] [像素宽=900]
import bpy, sys, os, glob, math, mathutils

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
indir = os.path.abspath(argv[0] if argv else '/tmp/mycar-glb')
outdir = os.path.abspath(argv[1] if len(argv) > 1 else os.path.join(indir, 'png'))
NVIEW = int(argv[2]) if len(argv) > 2 else 2
RES = int(argv[3]) if len(argv) > 3 else 900
os.makedirs(outdir, exist_ok=True)

# 注意：glTF 导入 Blender 后自动转成 Z-up —— X=车宽, Y=车长, Z=车高。
# 所以机位方向是 (右, 前/后, 上)：前右侧 3/4、后左侧 3/4。
# A/B 用同一机位：只有"车壳在不在"这一个变量，便于对照
DIRS = [mathutils.Vector((1.0, -1.15, 0.62)), mathutils.Vector((1.0, -1.15, 0.62))]


def scene_setup():
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 64
    sc.cycles.use_denoising = True
    sc.render.resolution_x = RES
    sc.render.resolution_y = int(RES * 0.72)
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'Standard'
    try:                                   # 有 N 卡就走 GPU，否则回退 CPU
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'OPTIX'
        prefs.get_devices()
        if any(d.type in ('OPTIX', 'CUDA') for d in prefs.devices):
            prefs.devices[0].use = True
            sc.cycles.device = 'GPU'
            print('[render] Cycles GPU:', prefs.devices[0].name)
        else:
            print('[render] Cycles CPU')
    except Exception as e:
        print('[render] GPU 不可用，用 CPU:', e)
    # 世界：柔和的冷灰环境光
    w = bpy.data.worlds.new('W'); sc.world = w; w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.42, 0.47, 0.55, 1.0)
    bg.inputs[1].default_value = 0.9
    # 地面
    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
    gp = bpy.context.object
    m = bpy.data.materials.new('ground'); m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (0.22, 0.24, 0.27, 1)
    bsdf.inputs['Roughness'].default_value = 0.9
    gp.data.materials.append(m)
    # 主光 + 补光
    bpy.ops.object.light_add(type='SUN', location=(6, -6, 12))
    sun = bpy.context.object; sun.data.energy = 3.4; sun.data.angle = math.radians(8)
    sun.rotation_euler = mathutils.Vector((0.5, 0.7, -1.0)).to_track_quat('-Z', 'Y').to_euler()
    bpy.ops.object.light_add(type='AREA', location=(-6, 4, 7))
    fill = bpy.context.object; fill.data.energy = 900; fill.data.size = 9
    fill.rotation_euler = mathutils.Vector((1.0, -0.7, -1.2)).to_track_quat('-Z', 'Y').to_euler()


def bbox_of(objs):
    lo = mathutils.Vector((1e9, 1e9, 1e9)); hi = -lo
    for o in objs:
        if o.type != 'MESH':
            continue
        for c in o.bound_box:
            w = o.matrix_world @ mathutils.Vector(c)
            lo = mathutils.Vector((min(lo[i], w[i]) for i in range(3)))
            hi = mathutils.Vector((max(hi[i], w[i]) for i in range(3)))
    return lo, hi


_CUT = {}


def render_one(glb, tag):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene_setup()
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=glb)
    imported = [o for o in bpy.data.objects if o not in before]
    lo, hi = bbox_of(imported)
    center = (lo + hi) / 2
    radius = max((hi - lo).length / 2, 0.5)
    cam_data = bpy.data.cameras.new('cam'); cam_data.lens_unit = 'FOV'
    cam_data.angle = math.radians(38)
    cam = bpy.data.objects.new('cam', cam_data); bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    for i in range(NVIEW):
        d = DIRS[i % len(DIRS)]
        if i == 1:
            bpy.ops.wm.read_factory_settings(use_empty=True)   # 换模型：B 视角用剖切版
            scene_setup()
            before2 = set(bpy.data.objects)
            bpy.ops.import_scene.gltf(filepath=_CUT.get(tag, glb))
            imported = [o for o in bpy.data.objects if o not in before2]
            lo, hi = bbox_of(imported); center = (lo + hi) / 2
            radius = max((hi - lo).length / 2, 0.5)
            cam_data = bpy.data.cameras.new('cam2'); cam_data.lens_unit = 'FOV'; cam_data.angle = math.radians(38)
            cam = bpy.data.objects.new('cam2', cam_data); bpy.context.scene.collection.objects.link(cam)
            bpy.context.scene.camera = cam
        dist = radius / math.tan(cam_data.angle / 2) * 1.12
        cam.location = center + d.normalized() * dist + mathutils.Vector((0, 0, radius * 0.14))
        cam.rotation_euler = (center - cam.location).to_track_quat('-Z', 'Y').to_euler()
        out = os.path.join(outdir, f'{tag}_{"A" if i == 0 else "B"}.png')
        bpy.context.scene.render.filepath = out
        bpy.ops.render.render(write_still=True)
        print('[render] ->', out, f'({(hi-lo).x:.2f}×{(hi-lo).y:.2f}×{(hi-lo).z:.2f} m)')


glbs = sorted(g for g in glob.glob(os.path.join(indir, '*.glb')) if not g.endswith('-solid.glb'))
print(f'[render] {len(glbs)} 个形态 -> {outdir}（{NVIEW} 视图/个，{RES}px）')
for g in glbs:
    tag = os.path.splitext(os.path.basename(g))[0]
    solid = g[:-4] + '-solid.glb'
    _CUT[tag] = g
    # A 视角：外形（封闭实体）；B 视角：剖切（看内饰）
    render_one(solid if os.path.exists(solid) and NVIEW > 1 else g, tag)
print('[render] 完成')
