"""Build the low-poly Granny and her intro animation in Blender 5.x.

The two perspective concepts guide the stoop, hair bun, face and batik colors.
The side/back, stature (1.55 m), chair pose and gesture are inferred.
Coordinates are metres, +Z up, -Y toward the player.
"""
from math import cos, pi, sin
from pathlib import Path
import random

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 24
scene.frame_start = 1


def material(name, rgb, roughness=0.87):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    color = tuple((channel / 255) ** 2.2 for channel in rgb) + (1,)
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = color
    shader.inputs["Roughness"].default_value = roughness
    mat.diffuse_color = color
    return mat


def batik(name, base, ink, blouse):
    mat = material(name, base)
    width, height = 256, 192
    texture = bpy.data.images.new(name, width=width, height=height, alpha=False)
    rng = random.Random(77)
    pixels = []
    for y in range(height):
        for x in range(width):
            u, v = x / width, y / height
            if blouse:
                row = int(v * 5)
                dx = abs((u * 12 + 0.5 * row) % 1 - 0.5)
                dy = abs(v * 5 % 1 - 0.5)
                diamond = dx + dy
                petal = (min(dx, dy) < 0.063 and max(dx, dy) < 0.32)
                print_ink = (0.20 < diamond < 0.27) or petal or diamond < 0.072
            else:
                stripe = (u * 6 - v * 4) % 1
                wave = abs(v * 10 % 1 - 0.5)
                print_ink = abs(stripe - 0.24 - 0.55 * wave) < 0.05 or (stripe > 0.75 and wave < 0.07)
            rgb = ink if print_ink else base
            grain = rng.uniform(0.85, 1.09) * (0.94 + 0.06 * sin(x * 0.19 + y * 0.11))
            pixels.extend([min(1, value * grain / 255) for value in rgb] + [1])
    texture.pixels.foreach_set(pixels)
    texture.pack()
    nodes = mat.node_tree.nodes
    image_node = nodes.new("ShaderNodeTexImage")
    image_node.image = texture
    mat.node_tree.links.new(image_node.outputs["Color"], nodes.get("Principled BSDF").inputs["Base Color"])
    return mat


skin = material("Ochre skin", (155, 99, 66))
skin_light = material("Cheek and nose", (177, 117, 77))
skin_dark = material("Eye socket", (87, 48, 34))
crease = material("Skin folds", (112, 63, 44))
hair = material("Silver hair", (113, 108, 102))
strand = material("Silver hair streak", (168, 159, 143))
sclera = material("Amber sclera", (191, 155, 111))
pupil = material("Dark iris", (40, 25, 18), 0.42)
lips = material("Pressed lips", (97, 53, 42))
blouse = batik("Umber floral batik blouse", (77, 37, 26), (165, 113, 58), True)
sarong = batik("Brown diagonal batik sarong", (58, 32, 25), (132, 75, 40), False)
collar = material("Turned batik edges", (71, 35, 26))
button = material("Brass buttons", (137, 91, 48))


def pivot(name, parent=None):
    obj = bpy.data.objects.new(name, None)
    scene.collection.objects.link(obj)
    obj.parent = parent
    return obj


def ellipsoid(name, parent, location, scale, mat, segments=12, rings=8):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings)
    obj = bpy.context.object
    obj.name = name
    obj.parent = parent
    obj.location = location
    for vertex in obj.data.vertices:
        for axis in range(3):
            vertex.co[axis] *= scale[axis]
    obj.data.materials.append(mat)
    return obj


def loft(name, parent, profiles, mat, sides=12):
    # Each ring specifies height, half width, half depth, and centre depth.
    vertices = [
        (rx * sin(2 * pi * i / sides), cy - ry * cos(2 * pi * i / sides), z)
        for z, rx, ry, cy in profiles for i in range(sides)
    ]
    faces = [tuple(reversed(range(sides)))]
    for row in range(len(profiles) - 1):
        for i in range(sides):
            a = row * sides + i
            b = row * sides + (i + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    faces.append(tuple(range(len(vertices) - sides, len(vertices))))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(mat)
    uv = mesh.uv_layers.new().data
    for face in mesh.polygons[1:-1]:
        row, column = divmod(face.index - 1, sides)
        u0, u1 = column / sides, (column + 1) / sides
        v0, v1 = row / (len(profiles) - 1), (row + 1) / (len(profiles) - 1)
        for loop, point in zip(face.loop_indices, [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]):
            uv[loop].uv = point
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    obj.parent = parent
    return obj


def line(name, parent, points, radius, mat):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 1
    curve.bevel_depth = radius
    curve.bevel_resolution = 0
    path = curve.splines.new("POLY")
    path.points.add(len(points) - 1)
    for point, coord in zip(path.points, points):
        point.co = (*coord, 1)
    obj = bpy.data.objects.new(name, curve)
    scene.collection.objects.link(obj)
    obj.parent = parent
    obj.data.materials.append(mat)
    return obj


granny = pivot("Granny")
torso = pivot("Spine", granny)
loft("Tailored batik kebaya", torso, [
    (-0.16, 0.202, 0.114, 0.025), (-0.11, 0.197, 0.122, 0.018),
    (0.015, 0.171, 0.105, 0.007), (0.18, 0.205, 0.115, -0.02),
    (0.285, 0.218, 0.105, -0.022), (0.333, 0.153, 0.090, -0.040),
    (0.348, 0.078, 0.069, -0.049),
], blouse)
ellipsoid("Neck", torso, (0, -0.068, 0.349), (0.063, 0.057, 0.085), skin)
line("Blouse opening", torso, [(0, -.108, -.14), (0, -.11, .0), (0, -.138, .18), (0, -.126, .27)], .010, collar)
for side in [-1, 1]:
    line(f"Collar {side}", torso, [(side*.088, -.110, .337), (side*.051, -.128, .28), (0, -.139, .216)], .015, collar)
for z, y in [(0.02, -.109), (0.085, -.12), (0.153, -.134), (0.212, -.144)]:
    ellipsoid(f"Button {z}", torso, (0, y, z), (.009, .006, .009), button, 8, 4)

head = pivot("Head", torso)
head.location = (0, -0.078, .365)
head.scale = (1.11, 1.06, 1.11)
loft("Faceted head", head, [
    (.00, .035, .038, -.029), (.025, .062, .055, -.017), (.053, .078, .069, -.005),
    (.083, .090, .082, 0), (.123, .091, .078, .005), (.161, .083, .079, .010),
    (.191, .073, .068, .018), (.208, .045, .047, .019),
], skin, 16)
ellipsoid("Hair cap", head, (0, .037, .156), (.097, .084, .083), hair, 16)
ellipsoid("Hair bun", head, (0, .067, .232), (.047, .044, .038), hair)
for side in [-1, 1]:
    ellipsoid(f"Ear {side}", head, (side*.088, .003, .096), (.018, .017, .030), skin)
    ellipsoid(f"Temple {side}", head, (side*.081, -.012, .156), (.018, .025, .049), hair)
    ellipsoid(f"Cheekbone {side}", head, (side*.055, -.059, .080), (.035, .019, .026), skin_light)
    ellipsoid(f"Eye socket {side}", head, (side*.040, -.069, .111), (.032, .015, .017), skin_dark)
    ellipsoid(f"Eye {side}", head, (side*.039, -.082, .111), (.021, .010, .0076), sclera)
    ellipsoid(f"Iris {side}", head, (side*.037, -.0915, .111), (.0074, .0023, .0070), pupil)
    line(f"Brow {side}", head, [(side*.014, -.079, .128), (side*.041, -.083, .133), (side*.068, -.062, .123)], .005, hair)
    line(f"Eye bag {side}", head, [(side*.021, -.080, .099), (side*.043, -.079, .094), (side*.071, -.060, .100)], .0025, crease)
    line(f"Smile fold {side}", head, [(side*.023, -.082, .080), (side*.041, -.074, .060), (side*.046, -.065, .039)], .0028, crease)
    for i in range(5):
        x = .021 + i * .014
        line(f"Hair sweep {side} {i}", head, [(side*x, -.040 + .001*i, .202 - .008*i),
             (side*(x*.92 + .009), -.017, .217 - .003*i), (side*(x*.55 + .009), .031, .229 - .001*i)], .002, strand)

nose = loft("Angular nose", head, [
    (.070, .014, .010, -.084), (.082, .021, .023, -.085),
    (.103, .012, .020, -.077), (.132, .008, .009, -.072),
], skin_light, 8)
for z, width, y in [(.151, .043, -.066), (.165, .041, -.063), (.177, .033, -.058)]:
    line(f"Forehead fold {z}", head, [(-width, y+.007, z-.002), (-.014, y, z), (.017, y, z+.001), (width, y+.007, z-.003)], .0021, crease)
line("Pressed mouth", head, [(-.034, -.066, .047), (-.014, -.079, .052), (0, -.082, .050), (.016, -.079, .052), (.034, -.066, .046)], .003, lips)
line("Chin fold", head, [(-.023, -.071, .033), (0, -.077, .032), (.023, -.071, .033)], .002, crease)

skirt = loft("Wrapped batik sarong", granny, [
    (0, .150, .127, .014), (.12, .163, .134, .009), (.33, .180, .145, 0),
    (.52, .189, .139, 0), (.70, .183, .117, .021), (.82, .171, .108, .019),
], sarong)

arms = {}
feet = {}
for side in [-1, 1]:
    upper = loft(f"Upper sleeve {side}", granny, [
        (-.015, .075, .068, 0), (.037, .078, .071, 0), (.215, .054, .051, 0), (.249, .052, .051, 0),
    ], blouse, 10)
    lower = loft(f"Lower sleeve {side}", granny, [
        (-.026, .055, .051, 0), (.040, .055, .054, 0), (.187, .039, .040, 0), (.202, .037, .037, 0),
    ], blouse, 10)
    hand = pivot(f"Hand {side}", granny)
    ellipsoid(f"Palm {side}", hand, (0, 0, .034), (.030, .018, .045), skin)
    for i in range(4):
        x = -.019 + .013 * i
        pointer = side == -1 and i == 2
        reach = .142 if pointer else .088 - .005 * abs(2 - i)
        line(f"Finger {side} {i}", hand, [(x, -.002, .056), (x, -.004, .076), (x, .004 if pointer else .016, reach)], .0067, skin)
    line(f"Thumb {side}", hand, [(side*.019, -.003, .016), (side*.038, 0, .034), (side*.035, .012, .057)], .008, skin)
    arms[side] = upper, lower, hand
    feet[side] = ellipsoid(f"Bare foot {side}", granny, (side*.090, -.067, .041), (.052, .106, .041), skin)


def animate(obj, frame, fields):
    for field in fields:
        obj.keyframe_insert(data_path=field, frame=frame)


def aim(obj, start, end, frame, length):
    offset = Vector(end) - Vector(start)
    obj.location = start
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(offset.normalized())
    obj.scale.z = offset.length / length
    animate(obj, frame, ("location", "rotation_quaternion", "scale"))


# time, floor x/y, hip height, lean, seat fraction, and extended-arm fraction.
poses = [
    (0.00, -.36, 3.26, .78, .18, 0, 0),
    (1.28, -.36, 3.26, .78, .18, 0, 0),
    (1.72, -.33, 3.04, .79, .18, 0, 0),
    (2.15, -.28, 2.66, .775, .18, 0, 0),
    (2.58, -.19, 2.20, .79, .18, 0, 0),
    (3.00, -.09, 1.72, .78, .18, 0, 0),
    # Stop in front of the chair before sitting.
    (3.30, 0, 1.39, .78, .18, 0, 0),
    (3.52, 0, 1.39, .78, .18, 0, 0),
    (3.83, 0, 1.39, .64, .32, .56, 0),
    (4.23, 0, 1.39, .47, .25, 1, 0),
    (4.95, 0, 1.39, .47, .25, 1, 0),
    # Gesture after a seated pause and hold until the player accepts.
    (5.25, 0, 1.39, .47, .28, 1, .32),
    (5.75, 0, 1.39, .47, .32, 1, 1),
    (6.45, 0, 1.39, .47, .32, 1, 1),
    (7.25, 0, 1.39, .47, .25, 1, 0),
]
scene.frame_end = round(poses[-1][0] * scene.render.fps) + scene.frame_start
for index, (time, x, y, height, lean, seat, point) in enumerate(poses):
    frame = round(time * scene.render.fps) + scene.frame_start
    granny.location = (x, y, 0)
    animate(granny, frame, ("location",))
    torso.location.z = height
    torso.rotation_euler.x = lean
    head.rotation_euler.x = -lean * .66
    animate(torso, frame, ("location", "rotation_euler"))
    animate(head, frame, ("rotation_euler",))
    skirt.location.y = -.092 * seat
    skirt.rotation_euler.x = -.11 * seat
    skirt.scale = (1 + .12 * seat, 1 + .42 * seat, 1 - .40 * seat)
    animate(skirt, frame, ("location", "rotation_euler", "scale"))
    for side, (upper, lower, hand) in arms.items():
        step = side * (-1 if index % 2 else 1) * .09 if 2 <= index <= 5 else 0
        shoulder = (side*.185, -.066 - lean*.24, height + .268)
        reach = point if side == -1 else 0
        elbow = (side*(.226 + .149*reach), -.093 - .235*seat - .105*reach, height + .048 + .107*seat + .235*reach)
        wrist = (side*(.215 + .203*reach), -.103 - .368*seat - .192*reach, height - .141 + .365*seat + .314*reach)
        aim(upper, shoulder, elbow, frame, .24)
        aim(lower, elbow, wrist, frame, .20)
        aim(hand, wrist, (wrist[0] - .072*reach, wrist[1] - .060 - .054*seat,
                          wrist[2] - .10 + .063*seat - .043*reach), frame, .115)
        feet[side].location = (side*.090, -.065 + step*1.7 - .21*seat, .041 + max(0, step)*.65)
        animate(feet[side], frame, ("location",))

scene.frame_set(1)
out = ROOT / "public" / "models" / "granny.glb"
out.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=str(out), export_format="GLB", export_animation_mode="SCENE",
    export_anim_scene_split_object=False,
)
