# 转台动画：一个 .glb → 绕车一周的 mp4（Blender 内置 FFMPEG 编码，无需外部 ffmpeg）
# 用法: blender -b -P scripts/blender-turntable.py -- <model.glb> <out.mp4|目录> [帧数=72] [像素宽=1000] [俯角°=22]
#         [引擎=cycles|eevee] [起始帧=0] [png=目录模式]
# 分块并行：每块传不同的起始帧 + 总帧数（NF 用**总**帧数算角度）、png 模式出序列，最后 ffmpeg 拼。
import importlib, sys, os, math
from typing import NoReturn
try:                                              # 这两个模块只在 Blender 自带 Python 里存在
    bpy = importlib.import_module('bpy')
    mathutils = importlib.import_module('mathutils')
except ImportError:
    raise SystemExit('这个脚本只能用 Blender 跑：blender -b -P scripts/blender-turntable.py -- …')

USAGE = ('用法: blender -b -P scripts/blender-turntable.py -- <model.glb> <out.mp4|目录> '
         '[帧数=72] [像素宽=1000] [俯角°=22] [cycles|eevee] [起始帧=0] [png]')


def bad_arg(name, raw, want) -> NoReturn:
    """参数不对就直接退出（不返回，类型检查据此知道下面的值一定不是 None）。"""
    raise SystemExit(f'参数 {name} 应该是{want}：{raw!r}\n' + USAGE)


def arg_int(i: int, default: int, name: str) -> int:
    if len(argv) <= i or argv[i] == '':
        return default
    try:
        return int(argv[i])
    except ValueError:
        bad_arg(name, argv[i], '整数')


def arg_float(i: int, default: float, name: str) -> float:
    if len(argv) <= i or argv[i] == '':
        return default
    try:
        return float(argv[i])
    except ValueError:
        bad_arg(name, argv[i], '数字')


argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if not argv:
    bad_arg('model.glb', '', '一个 .glb 路径')
glb = os.path.abspath(argv[0])
out = os.path.abspath(argv[1] if len(argv) > 1 else os.path.splitext(glb)[0] + '-turntable.mp4')
if not os.path.exists(glb):
    raise SystemExit(f'找不到模型：{glb}')
NF = arg_int(2, 72, '帧数')
RES = arg_int(3, 1000, '像素宽')
ELEV = math.radians(arg_float(4, 22, '俯角'))
ENGINE = (argv[5] if len(argv) > 5 else 'cycles').lower()
F0 = arg_int(6, 0, '起始帧')            # 本块的起始帧（角度 = 2π(f)/总帧数）
PNGMODE = len(argv) > 7 and argv[7] == 'png'

# 清空 Blender 启动场景（默认的 Cube/Camera/Light 不清掉会渲进画面里 —— 之前那只白色方块就是它）
for _o in list(bpy.data.objects):
    bpy.data.objects.remove(_o, do_unlink=True)

sc = bpy.context.scene
if ENGINE == 'eevee':
    sc.render.engine = 'BLENDER_EEVEE_NEXT'
    sc.eevee.taa_render_samples = 32
    sc.eevee.use_raytracing = True
    print('[turntable] EEVEE Next')
else:
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
try:
    RESY = (int(RES * 0.72) // 2) * 2                # H.264 要求偶数高
except (TypeError, ValueError) as e:
    raise SystemExit(f'像素宽不对：{RES!r}（{e}）\n' + USAGE)
sc.render.resolution_x = RES
sc.render.resolution_y = RESY
sc.render.fps = 24
# 直接输出 mp4（Blender 自带编码器）
if PNGMODE:
    try:
        os.makedirs(out, exist_ok=True)
    except OSError as e:
        raise SystemExit(f'建不了目录 {out}：{e}')
    sc.render.image_settings.file_format = 'PNG'
    sc.render.filepath = os.path.join(out, 'f')
else:
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

def arg_int_env(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw == '':
        return default
    try:
        return int(raw)
    except ValueError:
        raise SystemExit(f'环境变量 {name} 应该是整数：{raw!r}')


TOTAL = NF if F0 == 0 else max(NF, arg_int_env('TOTAL_FRAMES', NF))
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
# 每一帧都要**重新摆机位再出图**：原来只摆机位不关键帧 → animation 渲染出来 NF 张同一个角度。
sc.frame_start = 1; sc.frame_end = TOTAL
sc.frame_set(1)
for i in range(NF):
    f = F0 + i
    a = 2 * math.pi * f / TOTAL
    d = mathutils.Vector((math.cos(a), math.sin(a), 0)) * math.cos(ELEV) + mathutils.Vector((0, 0, math.sin(ELEV)))
    cam.location = center + d * dist
    cam.rotation_euler = (center - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.frame_set(f + 1)                      # 帧号 = 全局帧号 → 各分块的 PNG 文件名天然不撞
    if PNGMODE:
        sc.render.filepath = os.path.join(out, f'f{f + 1:04d}')   # write_still 不自动加帧号，得自己写
    bpy.ops.render.render(write_still=True)
print(f'[turntable] {NF} 帧（全局帧 {F0 + 1}–{F0 + NF} / 总 {TOTAL}）-> {out}（{radius*2:.1f}m 包围球）')
print('[turntable] 完成')
