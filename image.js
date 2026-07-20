function frame2matrix(canvas) {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const matrix = [];

    for (let y = 0; y < canvas.height; y++) {
        const row = [];
        for (let x = 0; x < canvas.width; x++) {
            const index = (y * canvas.width + x) * 4;
            const rgb = [
                data[index],
                data[index + 1],
                data[index + 2]
            ]
            row.push(rgb);
        }
        matrix.push(row);
    }
    return matrix;
}

function extractSections(rgbMatrix, scale = 9, rgb = true) {
    const height = rgbMatrix.length;
    const width = rgbMatrix[0].length;
    let vectors = []

    for (let y = 0; y < height - scale; y += scale) {
        for (let x = 0; x < width - scale; x += scale) {
            let vector = rgb ? (new Uint8Array(255)) : []
            let i = 0
            for (let y2 = 0; y2 < scale; y2++) {
                for (let x2 = 0; x2 < scale; x2++) {
                    if (rgb) {
                        vector[i] = rgbMatrix[y + y2][x + x2][0]
                        vector[i + 1] = rgbMatrix[y + y2][x + x2][1]
                        vector[i + 2] = rgbMatrix[y + y2][x + x2][2]
                        i += 3
                    }
                    else {
                        vector[i] = rgbMatrix[y + y2][x + x2]
                        i++
                    }

                }
            }
            if (rgb) {
                //normalize(vector)
            }
            vectors.push(vector)
        }
    }

    return vectors;
}

function paintVector(rgbArray, feature = true, x = 0, y = 0, id = undefined, append, pool = false) {
    try {
        let cnvs = feature ? document.createElement("canvas") : document.getElementById("canvas3")
        if (!append && id !== undefined && !pool) {
            cnvs = document.getElementById(String(id))
        }

        if (feature) {
            cnvs.width = 45
            cnvs.height = 45
        }
        let ctx = cnvs.getContext("2d")
        let imageData = new ImageData(9, 9)
        for (let i = 0; i < rgbArray.length / 3; i++) {
            const index = i * 4; // Each pixel has 4 values (RGBA)
            imageData.data[index] = rgbArray[i * 3];     // Red
            imageData.data[index + 1] = rgbArray[i * 3 + 1]; // Green
            imageData.data[index + 2] = rgbArray[i * 3 + 2]; // Blue
            imageData.data[index + 3] = 255;              // Alpha
        }

        ctx.imageSmoothingEnabled = false;

        if (feature) {
            createImageBitmap(imageData).then(renderer =>
                ctx.drawImage(renderer, 0, 0, 45, 45)
            )

            if (append) {

                cnvs.id = String(id)

                document.body.appendChild(cnvs)
                let s = document.createElement("span")
                s.innerText = " "
                document.body.appendChild(s)
            }
        }
        else {
            ctx.putImageData(imageData, x, y)
            if (toHighlight.includes(id)){
                 highlight(id, x, y, cnvs)
            }
           
        }
    }
    catch (e) {
        console.log("paint error", {
            id: id
        })
    }
}

function paintPool(pools, featureDB) {
    let i = 0;

    try {
        for (let y = 0; y < 180; y += 18) {
            for (let x = 0; x < 180; x += 18) {
                let pool = pools[i];
                let offsetx = 0;
                let offsety = 0;

                pool.forEach((featureIndex, fi) => {
                    switch (fi) {
                        case 0:
                            break;
                        case 1:
                            offsetx = 9;
                            break;
                        case 2:
                            offsetx = 0;
                            offsety = 9;
                            break;
                        case 3:
                            offsetx = 9;
                            offsety = 9;
                            break;
                    }

                    // Safety check: Ensure the feature actually exists in the database

                    if (featureDB && featureDB[featureIndex]) {
                        paintVector(featureDB[featureIndex], false, x + offsetx, y + offsety, featureIndex, false, true);
                    }
                });
                i++;
            }
        }
    }
    catch (e) {
        console.log("pool paint failed at pool " + i, e);
    }
}

