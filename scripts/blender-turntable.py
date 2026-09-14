# 转台动画：一个 .glb → 绕车一周的 mp4（Blender 内置 FFMPEG 编码，无需外部 ffmpeg）
# 用法: blender -b -P scripts/blender-turntable.py -- <model.glb> <out.mp4> [帧数=72] [像素宽=1000] [俯角°=22]
import bpy, sys, os, math, mathutils

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
glb = os.path.abspath(argv[0])
out = os.path.abspath(argv[1] if len(argv) > 1 else os.path.splitext(glb)[0] + '-turntable.mp4')
NF = int(argv[2]) if len(argv) > 2 else 72
RES = int(argv[3]) if len(argv) > 3 else 1000
ELEV = math.radians(float(argv[4]) if len(argv) > 4 else 22)

sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.samples = 48
sc.cycles.use_denoising = True
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'OPTIX'; prefs.get_devices()
    if any(d.type in ('OPTIX', 'CUDA') for d in prefs.devices):
        prefs.devices[0].use = True; sc.cycles.device = 'GPU'
        print('[turntable] Cycles GPU:', prefs.devices[0].name)
except Exception as e:
    print('[turntable] CPU:', e)
sc.view_settings.view_transform = 'Standard'
sc.render.resolution_x = RES
sc.render.resolution_y = int(RES * 0.72)
sc.render.fps = 24
# 直接输出 mp4（Blender 自带编码器）
sc.render.image_settings.file_format = 'FFMPEG'
sc.render.ffmpeg.format = 'MPEG4'
sc.render.ffmpeg.codec = 'H264'
sc.render.ffmpeg.constant_rate_factor = 'HIGH'
sc.render.filepath = out

w = bpy.data.worlds.new('W'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.42, 0.47, 0.55, 1.0)
w.node_tree.nodes['Background'].inputs[1].default_value = 0.9
bpy.ops.mesh.primitive_plane_add(size=80, location=(0, 0, 0))
gp = bpy.context.object
m = bpy.data.materials.new('ground'); m.use_nodes = True
m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.2, 0.22, 0.25, 1)
m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9
gp.data.materials.append(m)
bpy.ops.object.light_add(type='SUN', location=(6, -6, 12))
bpy.context.object.data.energy = 3.4
bpy.context.object.rotation_euler = mathutils.Vector((0.5, 0.7, -1.0)).to_track_quat('-Z', 'Y').to_euler()

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
cam_data = bpy.data.cameras.new('cam'); cam_data.lens_unit = 'FOV'; cam_data.angle = math.radians(34)
cam = bpy.data.objects.new('cam', cam_data); sc.collection.objects.link(cam); sc.camera = cam
dist = radius / math.tan(cam_data.angle / 2) * 1.1
sc.frame_start = 1; sc.frame_end = NF
for f in range(NF):
    a = 2 * math.pi * f / NF
    d = mathutils.Vector((math.cos(a), math.sin(a), 0)) * math.cos(ELEV) + mathutils.Vector((0, 0, math.sin(ELEV)))
    cam.location = center + d * dist
    cam.rotation_euler = (center - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.frame_set(f + 1)
print(f'[turntable] {NF} 帧 -> {out}（{radius*2:.1f}m 包围球）')
bpy.ops.render.render(animation=True)
print('[turntable] 完成')
