# 影片渲染：读 frames.json（由 scripts/bake-frames.mjs 从蓝图 v13 逐帧烘焙）→ 建对象/材质/关键帧
# + 相机路径 + 灯光 → 输出 PNG 序列（再由 ffmpeg 合成）。
# 本脚本只在 Blender 内跑（blender -b -P ...）：bpy/mathutils 由 Blender 提供，用 importlib 动态取，
# 这样静态分析器不会把"Blender 专属模块"报成坏引用。
import importlib, json, sys, math, os

bpy = importlib.import_module('bpy')
_mu = importlib.import_module('mathutils')
Vector, Matrix, Quaternion = _mu.Vector, _mu.Matrix, _mu.Quaternion

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if not argv:
    print('[film] 需要参数: <frames.json> <outdir> [起帧] [止帧] [宽] [引擎]'); sys.exit(1)
src = os.path.abspath(argv[0])
outdir = os.path.abspath(argv[1] if len(argv) > 1 else '/tmp/mycar-film/out')
def argi(i, dflt):
    try:
        return int(argv[i])
    except (IndexError, ValueError):
        return dflt


def envf(name, dflt):
    try:
        return float(os.environ.get(name, str(dflt)))
    except (TypeError, ValueError):
        return dflt


def envi(name, dflt):
    try:
        return int(os.environ.get(name, str(dflt)))
    except (TypeError, ValueError):
        return dflt
F0 = argi(2, 0)
F1 = argi(3, 10 ** 9)
RES = argi(4, 1600)
ENGINE = argv[5] if len(argv) > 5 and argv[5] in ('eevee', 'cycles') else 'eevee'
try:
    os.makedirs(outdir, exist_ok=True)
except OSError as e:
    print('[film] 输出目录建不了:', e); sys.exit(1)
try:
    with open(src) as fh:
        D = json.load(fh)
except (OSError, ValueError) as e:
    print('[film] frames.json 读不了:', e); sys.exit(1)
FPS = D['fps']
SHOTS = {s['name']: (s['f0'], s['f1']) for s in D['shots']}
PPL = D['meta']['AN']

# ---------------------------------------------------------------- 场景准备
# 环境（D66 用户要求）：蓝天白云 + 草地 + 顶光自然太阳光；不再是暗棚。
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.fps = FPS
sc.render.resolution_x = RES
sc.render.resolution_y = (RES * 9) // 16
sc.render.film_transparent = False
sc.view_settings.view_transform = 'Filmic'
sc.view_settings.exposure = -0.6
sc.render.image_settings.file_format = 'PNG'
sc.render.filepath = os.path.join(outdir, 'f')
if ENGINE == 'cycles':
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = envi('FILM_SAMPLES', 128)
    sc.cycles.use_denoising = True
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'OPTIX'; prefs.get_devices()
        prefs.devices[0].use = True; sc.cycles.device = 'GPU'
    except Exception as e:
        print('[film] Cycles CPU:', e)
else:
    sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in \
        [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
    sc.eevee.taa_render_samples = envi('FILM_SAMPLES', 48)
    if hasattr(sc.eevee, 'use_raytracing'):
        sc.eevee.use_raytracing = bool(envi('FILM_RT', 0))
    sc.render.use_motion_blur = True
    sc.render.motion_blur_shutter = 0.35

# 天空：Nishita 物理天空（自带太阳盘，就是"顶上照进来的自然太阳光"）
w = bpy.data.worlds.new('W'); sc.world = w
w.use_nodes = True
nt = w.node_tree
bg = nt.nodes['Background']
sky = nt.nodes.new('ShaderNodeTexSky')
sky.sky_type = 'NISHITA'
sky.sun_elevation = math.radians(48)
sky.sun_rotation = math.radians(35)
# 世界 = 自绘的蓝天渐变（Nishita 在 Filmic 下偏绿，弃用）+ 噪声白云
tc = nt.nodes.new('ShaderNodeTexCoord')
sep = nt.nodes.new('ShaderNodeSeparateXYZ')
nt.links.new(tc.outputs['Generated'], sep.inputs['Vector'])      # 视线方向 → Z = 仰角
skyg = nt.nodes.new('ShaderNodeValToRGB')
skyg.color_ramp.interpolation = 'EASE'
skyg.color_ramp.elements[0].position = 0.38                      # 地平线
skyg.color_ramp.elements[0].color = (0.30, 0.52, 0.85, 1)        # 近地平线：天蓝
skyg.color_ramp.elements[1].position = 0.75                      # 天顶
skyg.color_ramp.elements[1].color = (0.10, 0.28, 0.62, 1)        # 天顶：深蓝
nt.links.new(sep.outputs['Z'], skyg.inputs['Fac'])
cloud = nt.nodes.new('ShaderNodeTexNoise')
cloud.inputs['Scale'].default_value = 3.5
cloud.inputs['Detail'].default_value = 9
cloud.inputs['Roughness'].default_value = 0.6
cramp = nt.nodes.new('ShaderNodeValToRGB')
cramp.color_ramp.elements[0].position = 0.50
cramp.color_ramp.elements[0].color = (0, 0, 0, 1)
cramp.color_ramp.elements[1].position = 0.62
cramp.color_ramp.elements[1].color = (1, 1, 1, 1)
cmix = nt.nodes.new('ShaderNodeMixRGB'); cmix.blend_type = 'MIX'
cmix.inputs['Color1'].default_value = (0, 0, 0, 1)               # 无云处：透明天蓝
cmix.inputs['Color2'].default_value = (1, 1, 1, 1)               # 云：白
nt.links.new(cloud.outputs['Fac'], cramp.inputs['Fac'])
nt.links.new(cramp.outputs['Color'], cmix.inputs['Fac'])
nt.links.new(skyg.outputs['Color'], cmix.inputs['Color1'])
nt.links.new(cmix.outputs['Color'], bg.inputs['Color'])
bg.inputs[1].default_value = 1.0


PAL = {
    # D65 调色：车身银蓝 / 玻璃深墨 / 胎黑辋浅 / 底盘中性灰 / 床件暖棕 / 人肉粉 / 梁深钢
    'body3': '#a9b7c6', 'glass3': '#41616f', 'tyre3': '#15171a', 'rim3': '#a3adb6', 'arch3': '#b5565e',
    'trim3': '#1f2226', 'mach3': '#3e464e', 'cush3': '#c8bda8', 'lamp3': '#e8e4c8',
    'floor3': '#5e6a75', 'batt3': '#33606f', 'wet3': '#2f6274', 'seat3': '#b3aca0', 'seatO3': '#8a6ea0',
    'bed3': '#c2a878', 'isl3': '#7a6690', 'tbl3': '#9aa8b4', 'lk3': '#c0a86a', 'pop3': '#5b6a76',
    'tent3': '#3f6f9f', 'bunk3': '#7f8b96', 'scr3': '#3c444d', 'pj3': '#6a5a80', 'man3': '#d9a08c',
    'screen3': '#f2f2ee',
}
SHELL = {'body3', 'glass3', 'tent3'}
ROUGH = {'body3': 0.32, 'glass3': 0.05, 'tyre3': 0.85, 'rim3': 0.35, 'floor3': 0.7, 'seat3': 0.62,
         'bed3': 0.75, 'man3': 0.6, 'lk3': 0.45, 'trim3': 0.5, 'mach3': 0.6, 'cush3': 0.8,
         'lamp3': 0.2, 'screen3': 0.6, 'scr3': 0.5, 'pop3': 0.5, 'tent3': 0.6, 'bunk3': 0.7}


def srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_lin(h):
    h = (h or '#8899aa').lstrip('#')
    return tuple(srgb_to_lin(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4))


def blender_pt(x, y, z):                       # 车 mm → Blender m
    return (z / 1000.0, -x / 1000.0, y / 1000.0)


def obj_from_mesh(name, mesh, mat):
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(ob)
    if mat:
        ob.data.materials.append(mat)
    return ob


def cube(name, cls):
    me = bpy.data.meshes.new(name)
    v = [(-0.5, -0.5, -0.5), (0.5, -0.5, -0.5), (0.5, 0.5, -0.5), (-0.5, 0.5, -0.5),
         (-0.5, -0.5, 0.5), (0.5, -0.5, 0.5), (0.5, 0.5, 0.5), (-0.5, 0.5, 0.5)]
    f = [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (0, 3, 7, 4)]
    me.from_pydata(v, [], f)
    return obj_from_mesh(name, me, material(cls))


def cylinder(name, cls):
    me = bpy.data.meshes.new(name)
    N = 24
    v = [(math.cos(2 * math.pi * i / N) * .5, math.sin(2 * math.pi * i / N) * .5, -.5) for i in range(N)] + \
        [(math.cos(2 * math.pi * i / N) * .5, math.sin(2 * math.pi * i / N) * .5, .5) for i in range(N)]
    f = [(i, (i + 1) % N, (i + 1) % N + N, i + N) for i in range(N)] + [tuple(range(N)), tuple(range(N, 2 * N))]
    me.from_pydata(v, [], f)
    return obj_from_mesh(name, me, material(cls))


def prism(name, cls):
    return obj_from_mesh(name, bpy.data.meshes.new(name), material(cls))


def quad(name, cls):
    """刚性件：局部 X=车宽方向, Y=长度方向, Z=厚度。每帧只改 location/rotation/(长度)scale —— 真旋转，不是 bbox 伸缩。"""
    return cube(name, cls)


def set_prism(ob, z0, z1, pts, near_cap=True):
    """车身/玻璃：车 (x,y) 多边形 → Blender (Y,Z) 截面沿 X 挤出。
    剖切时把**近侧那个封盖去掉**（k='shell'）→ 看到的是"剖开的盒子"，而不是一块实心截面。"""
    me = ob.data
    me.clear_geometry()
    n = len(pts)
    verts = [blender_pt(p[0], p[1], z0) for p in pts] + [blender_pt(p[0], p[1], z1) for p in pts]
    faces = [tuple(range(n))]
    if near_cap:
        faces.append(tuple(range(2 * n - 1, n - 1, -1)))
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, j + n, i + n))
    me.from_pydata(verts, [], faces)
    me.update()


def set_box(ob, v):
    x0, x1, y0, y1, z0, z1 = v
    ob.location = ((z0 + z1) / 2000.0, -(x0 + x1) / 2000.0, (y0 + y1) / 2000.0)
    ob.scale = ((z1 - z0) / 1000.0, (x1 - x0) / 1000.0, (y1 - y0) / 1000.0)


def set_quad(ob, v):
    px, py, dx, dy, ln, th, z0, z1 = v
    th = max(6.0, th)
    ln = max(1.0, ln)
    n = math.hypot(dx, dy) or 1.0
    ob.location = blender_pt(px + dx / 2.0, py + dy / 2.0, (z0 + z1) / 2.0)
    ob.rotation_mode = 'XYZ'
    ob.rotation_euler = (math.atan2(dy, -dx), 0.0, 0.0)      # 绕车宽轴旋转（= Blender X）
    ob.scale = ((z1 - z0) / 1000.0, ln / 1000.0, th / 1000.0)


def set_cyl(ob, v):
    cx, cy, r, z0, z1 = v
    ob.location = ((z0 + z1) / 2000.0, -cx / 1000.0, cy / 1000.0)
    ob.rotation_euler = (0, math.radians(90), 0)
    ob.scale = (r / 500.0, r / 500.0, (z1 - z0) / 1000.0)


MATS = {}


def material(cls, name=None, alpha=1.0):
    key = name or cls
    if key in MATS:
        return MATS[key]
    m = bpy.data.materials.new(key)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    col = hex_lin(PAL.get(cls, '#8899aa'))
    bsdf.inputs['Base Color'].default_value = (col[0], col[1], col[2], 1.0)
    bsdf.inputs['Roughness'].default_value = ROUGH.get(cls, 0.5)
    if cls in SHELL:
        bsdf.inputs['Alpha'].default_value = alpha
        try:
            m.blend_method = 'BLEND'
        except Exception:
            pass
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            pass
        if 'Transmission Weight' in bsdf.inputs:
            bsdf.inputs['Transmission Weight'].default_value = 0.15 if cls == 'glass3' else 0.0
    MATS[key] = m
    return m


# ---------------------------------------------------------------- 建车（按 partDefs 固定对象）
objs = {}
for key, meta in D['partDefs'].items():
    name = key.replace('/', '_')
    cls, k = meta['cls'], meta['k']
    if cls in ('arch3', 'man3'):
        continue                                   # 轮位包络=分析用；man3 占位盒=真小人在演
    ob = {'box': cube, 'cyl': cylinder, 'prism': prism, 'quad': quad, 'shell': prism}[k](name, cls)
    if cls in SHELL:                  # 幽灵壳：不投影（否则半透明阴影会渲染成一片噪点）
        ob.visible_shadow = False
        ob.visible_diffuse = False
        ob.visible_glossy = False
    objs[key] = (ob, k)

# ---------------------------------------------------------------- 建人（每人一套：两腿两臂 + 躯干 + 头）
def mk_person(slot):
    parts = {}
    mat = material('man3', 'man3_' + slot, 1.0)
    # 人体淡入淡出必须能混色：不透明材质会无视 Alpha
    try:
        mat.blend_method = 'BLEND'
    except Exception:
        pass
    try:
        mat.surface_render_method = 'BLENDED'
    except Exception:
        pass
    for nm in ['thighL', 'thighR', 'shinL', 'shinR', 'footL', 'footR', 'torso', 'neck',
               'armUL', 'armUR', 'armLL', 'armLR']:
        me = bpy.data.meshes.new('%s_%s' % (slot, nm))
        N = 12
        v = [(math.cos(2 * math.pi * i / N) * .5, math.sin(2 * math.pi * i / N) * .5, -.5) for i in range(N)] + \
            [(math.cos(2 * math.pi * i / N) * .5, math.sin(2 * math.pi * i / N) * .5, .5) for i in range(N)]
        f = [(i, (i + 1) % N, (i + 1) % N + N, i + N) for i in range(N)] + [tuple(range(N)), tuple(range(N, 2 * N))]
        me.from_pydata(v, [], f)
        parts[nm] = obj_from_mesh('%s_%s' % (slot, nm), me, mat)
    head = bpy.data.meshes.new(slot + '_head')
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=10, radius=0.5)
    head_obj = bpy.context.object
    head_obj.name = slot + '_head'
    head_obj.data.materials.append(mat)
    parts['head'] = head_obj
    try:
        bpy.ops.object.shade_smooth()
    except Exception:
        pass
    parts['_mat'] = mat
    return parts


# 人物槽位：优先用帧里出现过的（v17 的 bake 把 alpha 写在每帧上，D['alpha'] 可能是空的）
SLOTS = sorted({s for fr in D['frames'] for s in fr.get('people', {})} |
               {s for fr in D['frames'] for s in fr.get('alpha', {})} |
               set((D.get('alpha') or {}).keys()))
PEOPLE = {slot: mk_person(slot) for slot in SLOTS}


def bone(ob, a, b, width, zoff=0.0):
    """把一根"骨头"摆在 a→b 之间（车坐标 mm，z=车宽方向偏移 mm）"""
    pa = Vector(blender_pt(a[0], a[1], zoff))
    pb = Vector(blender_pt(b[0], b[1], zoff))
    d = pb - pa
    L = d.length
    if L < 1e-6:
        ob.scale = (0, 0, 0)
        return
    ob.location = (pa + pb) / 2
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    ob.rotation_mode = 'QUATERNION'
    ob.rotation_quaternion = q
    ob.scale = (width / 1000.0, width / 1000.0, L)


def set_person(slot, j):
    P = PEOPLE[slot]
    if not j:
        for k, ob in P.items():
            if k == '_mat':
                continue
            ob.scale = (0, 0, 0)
        return
    k = j.get('k', 1)
    W = lambda v: v * k / 1000.0
    hip, knee, ankle, foot = j['hip'], j['knee'], j['ankle'], j['foot']
    shd, neck, headC = j['shd'], j['neck'], j['headC']
    elbow, hand = j['elbow'], j['hand']
    zl, za = 68 * k, 108 * k
    bone(P['thighL'], hip, knee, PPL['legW'] * k, zl); bone(P['thighR'], hip, knee, PPL['legW'] * k, -zl)
    bone(P['shinL'], knee, ankle, PPL['shinW'] * k, zl); bone(P['shinR'], knee, ankle, PPL['shinW'] * k, -zl)
    bone(P['footL'], ankle, foot, PPL['footW'] * k, zl); bone(P['footR'], ankle, foot, PPL['footW'] * k, -zl)
    bone(P['torso'], hip, shd, PPL['torsoW'] * k, 0.0)
    bone(P['neck'], shd, neck, PPL['neckW'] * k, 0.0)
    bone(P['armUL'], shd, elbow, PPL['armW'] * k, za); bone(P['armUR'], shd, elbow, PPL['armW'] * k, -za)
    bone(P['armLL'], elbow, hand, PPL['armW'] * k, za); bone(P['armLR'], elbow, hand, PPL['armW'] * k, -za)
    h = P['head']
    h.location = Vector(blender_pt(headC[0], headC[1], 0))
    h.scale = (PPL['headR'] * k / 500.0,) * 3


# ---------------------------------------------------------------- 打关键帧
frames = D['frames']
cur_parts = {k: None for k in objs}
cur_ppl = {s: None for s in PEOPLE}
alpha = D['alpha']

# 末帧保持：把每个部件最后一次出现的值往后延（避免尾部消失）
last_val = {}
for fr in frames:
    for k, v in fr['parts'].items():
        last_val[k] = v
for k in objs:
    if last_val.get(k) and (F1 >= len(frames) - 1 or True):
        frames[-1]['parts'].setdefault(k, last_val[k])

# 先把 F0 之前累积到的状态"预热"到所有对象上 —— 这样从中间起渲（或单帧调试）也是完整的
prime = {}
for fr in frames:
    prime.update(fr['parts'])
    for slot, j in fr['people'].items():
        prime['@' + slot] = j
    prime['#shell'] = fr['cam']['shell']
    if fr['i'] >= F0:
        break
for key, v in prime.items():
    if key in objs:
        ob, kd = objs[key]
        if kd == 'box':
            set_box(ob, v)
        elif kd == 'cyl':
            set_cyl(ob, v)
        elif kd == 'quad':
            set_quad(ob, v)
        elif kd == 'shell':
            set_prism(ob, v[0], v[1], v[2:], near_cap=False)
        else:
            set_prism(ob, v[0], v[1], v[2:])
    elif key.startswith('@'):
        set_person(key[1:], v)
    elif key == '#shell':
        for cls in SHELL:
            if MATS.get(cls):
                MATS[cls].node_tree.nodes['Principled BSDF'].inputs['Alpha'].default_value = v

for fr in frames:
    i = fr['i']
    if i < F0 or i > F1:
        continue
    for key, v in fr['parts'].items():
        if key not in objs:            # arch3（轮位机能包络）是分析用，不进片子
            continue
        ob, kd = objs[key]
        if kd == 'box':
            set_box(ob, v)
            keys = ['location', 'scale']
        elif kd == 'cyl':
            set_cyl(ob, v)
            keys = ['location', 'scale', 'rotation_euler']
        elif kd == 'quad':
            set_quad(ob, v)                     # 刚性件：绕铰点真旋转（不是包围盒伸缩）
            keys = ['location', 'rotation_euler', 'scale']
        elif kd == 'shell':
            set_prism(ob, v[0], v[1], v[2:], near_cap=False)
            keys = []
        else:                                   # 车身/玻璃：只变多边形（静态形状）
            set_prism(ob, v[0], v[1], v[2:])
            keys = []
        for attr in keys:
            ob.keyframe_insert(data_path=attr, frame=i)
    for slot, j in fr['people'].items():
        set_person(slot, j)
        for nm, ob in PEOPLE[slot].items():
            if nm == '_mat':
                continue
            ob.keyframe_insert(data_path='location', frame=i)
            ob.keyframe_insert(data_path='scale', frame=i)
            ob.keyframe_insert(data_path='rotation_quaternion', frame=i) if ob.rotation_mode == 'QUATERNION' else None
    # 车壳透明度
    sh = fr['cam']['shell']
    for cls in SHELL:
        m = MATS.get(cls)
        if m:
            m.node_tree.nodes['Principled BSDF'].inputs['Alpha'].default_value = sh
            m.node_tree.nodes['Principled BSDF'].inputs['Alpha'].keyframe_insert('default_value', frame=i)
    # 人体淡入淡出（v17：alpha 在每一帧上；v13：在 D['alpha'][slot] 里按帧号查）
    for slot in PEOPLE:
        if slot in fr.get('alpha', {}):
            a = fr['alpha'][slot]
        elif slot in alpha:
            a = alpha[slot].get(str(i), alpha[slot].get(i, 1.0))
        else:
            a = 0.0
        m = PEOPLE[slot]['_mat']
        bsdf = m.node_tree.nodes['Principled BSDF']
        bsdf.inputs['Alpha'].default_value = a
        try:
            m.blend_method = 'BLEND' if a < 1.0 else 'OPAQUE'
        except AttributeError:                     # Blender 4.2+ 改用 surface_render_method
            m.surface_render_method = 'BLENDED' if a < 1.0 else 'DITHERED'
        bsdf.inputs['Alpha'].keyframe_insert('default_value', frame=i)

# ---------------------------------------------------------------- 相机
cam_data = bpy.data.cameras.new('Cam')
cam_data.lens = envf('FILM_LENS', 35.0)     # 取景松紧：镜头焦距
CAMK = envf('FILM_CAMK', 1.35)              # 机位相对目标的拉伸（不改蓝图时间轴，只调构图）
cam = bpy.data.objects.new('Cam', cam_data)
bpy.context.collection.objects.link(cam)
sc.camera = cam
for fr in frames:
    i = fr['i']
    if i < F0 or i > F1:
        continue
    tgt = Vector(blender_pt(fr['cam']['tgt'][0], fr['cam']['tgt'][1], fr['cam']['tgt'][2]))
    pos = tgt + (Vector(blender_pt(fr['cam']['pos'][0], fr['cam']['pos'][1], fr['cam']['pos'][2])) - tgt) * CAMK
    cam.location = pos
    q = (tgt - pos).to_track_quat('-Z', 'Y')
    cam.rotation_mode = 'QUATERNION'
    cam.rotation_quaternion = q
    cam.keyframe_insert('location', frame=i)
    cam.keyframe_insert('rotation_quaternion', frame=i)

# ---------------------------------------------------------------- 灯光 + 地面（草地 + 自然太阳光）
# 主光 = 太阳（从高处斜照，"自然太阳光"）；辅光只给很弱的冷补，照顾剖开的内腔。
sun = bpy.data.lights.new('Sun', 'SUN'); sun.energy = 2.2; sun.angle = math.radians(1.5)
so = bpy.data.objects.new('Sun', sun); bpy.context.collection.objects.link(so)
so.rotation_euler = (math.radians(42), 0, math.radians(35))   # 顶上偏前，接近天空盘的位置


def area(name, loc, energy, size, rot=None, color=(1, 1, 1)):
    d = bpy.data.lights.new(name, 'AREA'); d.energy = energy; d.size = size; d.color = color
    o = bpy.data.objects.new(name, d); bpy.context.collection.objects.link(o)
    o.location = blender_pt(*loc)
    if rot:
        o.rotation_euler = [math.radians(a) for a in rot]
    return o


fill = area('Fill', (500, 3000, 4200), 900, 3.0, color=(0.80, 0.88, 1.0))
k = fill.constraints.new('TRACK_TO'); k.target = cam


# 草地：一大块绿面 + 噪声混色（远看是草地，近看不穿帮）
def grass_mat():
    m = bpy.data.materials.new('Grass'); m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexNoise')
    tex.inputs['Scale'].default_value = 0.6
    tex.inputs['Detail'].default_value = 8
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (0.035, 0.115, 0.026, 1)
    ramp.color_ramp.elements[1].color = (0.11, 0.26, 0.06, 1)
    nt.links.new(tex.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.95
    return m


bpy.ops.mesh.primitive_plane_add(size=260, location=(0, 0, -0.02))
gnd = bpy.context.object
gnd.data.materials.append(grass_mat())
if os.environ.get('NO_GRASS'):
    gnd.hide_render = True



print('[film] frames %d..%d  objects=%d people=%d  engine=%s res=%d' %
      (F0, min(F1, len(frames) - 1), len(objs), len(PEOPLE), sc.render.engine, RES))
sc.frame_start = F0
sc.frame_end = min(F1, len(frames) - 1)
STRIDE = envi('FILM_STRIDE', 1)          # >1 = 抽帧（draft 检片用）


def apply_frame(fr):
    """把这一帧的几何/人/透明度/机位全部落到场景上。"""
    for key, v in fr['parts'].items():
        if key not in objs:              # arch3 之类分析用零件不进片子
            continue
        ob, kd = objs[key]
        if kd == 'box':
            set_box(ob, v)
        elif kd == 'cyl':
            set_cyl(ob, v)
        elif kd == 'quad':
            set_quad(ob, v)
        elif kd == 'shell':
            set_prism(ob, v[0], v[1], v[2:], near_cap=False)
        else:                            # prism：逐帧重建网格（形体在变，没有关键帧可插）
            set_prism(ob, v[0], v[1], v[2:])
    for slot, j in fr['people'].items():
        set_person(slot, j)
    sh = fr['cam']['shell']
    for cls in SHELL:
        m = MATS.get(cls)
        if m:
            m.node_tree.nodes['Principled BSDF'].inputs['Alpha'].default_value = sh
    for slot in PEOPLE:
        if slot in fr.get('alpha', {}):
            a = fr['alpha'][slot]
        elif slot in alpha:
            a = alpha[slot].get(str(fr['i']), alpha[slot].get(fr['i'], 1.0))
        else:
            a = 0.0
        PEOPLE[slot]['_mat'].node_tree.nodes['Principled BSDF'].inputs['Alpha'].default_value = a
    tgt = Vector(blender_pt(fr['cam']['tgt'][0], fr['cam']['tgt'][1], fr['cam']['tgt'][2]))
    pos = tgt + (Vector(blender_pt(fr['cam']['pos'][0], fr['cam']['pos'][1], fr['cam']['pos'][2])) - tgt) * CAMK
    cam.location = pos
    cam.rotation_mode = 'QUATERNION'
    cam.rotation_quaternion = (tgt - pos).to_track_quat('-Z', 'Y').to_euler() if False \
        else (tgt - pos).to_track_quat('-Z', 'Y')


# 逐帧渲染（**不是** render(animation=True)）：车身/剖面这类"逐帧重建网格、没有关键帧"的零件
# 在动画渲染里只会停在最后一帧的样子（第一版成片里"车壳凭空消失"就是这个）。
n = 0
for idx in range(F0, min(F1, len(frames) - 1) + 1, STRIDE):
    fr = frames[idx]
    sc.frame_set(fr['i'])                # 先让关键帧动画（运动模糊要用）落到这一帧
    apply_frame(fr)                      # 再把无关键帧的零件/材质/机位盖上去
    sc.render.filepath = os.path.join(outdir, 'f%04d' % fr['i'])
    bpy.ops.render.render(write_still=True)
    n += 1
    if n % 50 == 0:
        print('[film] %d/%d' % (n, (min(F1, len(frames) - 1) - F0) // max(1, STRIDE) + 1))
print('[film] done →', outdir)
